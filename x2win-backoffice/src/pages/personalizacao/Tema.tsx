import { useMemo } from 'react'
import { Check, Contrast, RotateCcw, SwatchBook } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  ColorInput,
  Field,
  FormFieldset,
  FormGrid,
  ImageUpload,
  PageHeader,
  SaveBar,
  TextLink,
  confirm,
  toast,
  useSettingsForm,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useCompany } from '@/domain/system'
import { usePageAccess } from '@/domain/session'
import {
  COLOR_LABEL,
  bestTextOn,
  contrastLevel,
  formatRatio,
  isHex,
  rgba,
  sitePalette,
  themeContrastChecks,
  validateTheme,
  type ContrastCheck,
  type SiteColors,
  type SiteTheme,
} from '@/domain/personalizacao-p1'
import { DEFAULT_THEME, P1_KEYS, SITE_DOMAIN, THEME_PRESETS } from '@/data/personalizacao-p1'
import { BrowserFrame, EditorLayout, EditorSection, PreviewJumpButton, PreviewPanel, SiteHeaderMock, SiteLogo, useSiteTitle } from './_shared-p1'

const COLOR_HINT: Record<keyof SiteColors, string> = {
  primary: 'Botões, links e item ativo do menu.',
  accent: 'Selos de bônus, valores de prêmio e avisos.',
  background: 'Fundo de todas as páginas.',
  surface: 'Cabeçalho, rodapé, cartões e janelas.',
  text: 'Texto principal do site.',
}

const COLOR_ORDER: (keyof SiteColors)[] = ['primary', 'accent', 'background', 'surface', 'text']

function sameColors(a: SiteColors, b: SiteColors) {
  return COLOR_ORDER.every((k) => a[k].toUpperCase() === b[k].toUpperCase())
}

function checkBadge(c: ContrastCheck): { tone: Tone; label: string } {
  if (c.kind === 'interface') return c.ok ? { tone: 'success', label: 'Visível' } : { tone: 'danger', label: 'Pouco visível' }
  const level = contrastLevel(c.ratio)
  if (level === 'AAA') return { tone: 'success', label: 'AAA' }
  if (level === 'AA') return { tone: 'success', label: 'AA' }
  if (level === 'grande') return { tone: 'warning', label: 'Só texto grande' }
  return { tone: 'danger', label: 'Ilegível' }
}

export default function Tema() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<SiteTheme>(P1_KEYS.tema, DEFAULT_THEME, {
    entity: 'Identidade e tema',
    successMessage: 'Identidade e tema salvos',
    validate: validateTheme,
  })
  const v = form.values
  const palette = useMemo(() => sitePalette(v.colors, DEFAULT_THEME.colors), [v.colors])
  const checks = useMemo(() => themeContrastChecks(v.colors), [v.colors])
  const failingText = checks.filter((c) => !c.ok && c.kind === 'texto')
  const failingAny = checks.filter((c) => !c.ok)
  const activePreset = THEME_PRESETS.find((p) => sameColors(p.colors, v.colors))
  const title = useSiteTitle()
  const [company] = useCompany()

  const setColor = (k: keyof SiteColors, value: string) => form.set('colors', { ...v.colors, [k]: value.toUpperCase() })

  const applyPreset = (id: string) => {
    const p = THEME_PRESETS.find((x) => x.id === id)
    if (!p) return
    form.set('colors', { ...p.colors })
    toast.info(`Paleta ${p.name} aplicada`, { description: 'Confira a prévia e salve para publicar no site.' })
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar a identidade padrão?',
      description: 'Logotipo, ícone, cores e imagem de compartilhamento voltam ao padrão da plataforma. O site só muda depois de salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    form.setValues(DEFAULT_THEME)
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
          <PreviewPanel description="Como o jogador vê o site com o rascunho atual." footer="A prévia usa o rascunho. O site só muda depois de salvar.">
            <ThemePreview theme={v} title={title} />
            <ul className="mt-3 grid grid-cols-5 gap-1.5" aria-label="Cores do rascunho">
              {COLOR_ORDER.map((k) => (
                <li key={k} className="min-w-0 text-center">
                  <span className="block h-7 rounded-md ring-1 ring-inset ring-line" style={{ background: isHex(v.colors[k]) ? v.colors[k] : 'transparent' }} />
                  <span className="mt-1 block truncate text-[10.5px] font-medium text-fg-2">{COLOR_LABEL[k]}</span>
                </li>
              ))}
            </ul>
          </PreviewPanel>
        }
      >
        <FormFieldset readOnly={form.readOnly}>
          <EditorSection
            title="Logotipo"
            description="Aparece no cabeçalho, no rodapé e nas telas de entrada e cadastro. Use PNG ou SVG com fundo transparente."
          >
            <ImageUpload
              label="Logotipo do site"
              width={200}
              height={100}
              value={v.logo}
              onChange={(url) => form.set('logo', url)}
              disabled={!canEdit}
              previewClassName="max-w-[300px]"
              hint="200×100 px"
            />
            {!v.logo && (
              <p className="-mt-3 text-xs font-medium text-danger" role="alert">
                O site precisa de um logotipo para salvar.
              </p>
            )}
            {v.logo && (
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-fg">Como fica sobre as cores do site</p>
                <div className="grid max-w-[420px] grid-cols-2 gap-2">
                  {(['background', 'surface'] as const).map((k) => (
                    <div key={k} className="overflow-hidden rounded-lg ring-1 ring-inset ring-line">
                      <div className="flex h-16 items-center justify-center px-3" style={{ background: palette[k] }}>
                        <SiteLogo src={v.logo} center className="h-12 w-full" alt={`Logotipo sobre ${COLOR_LABEL[k].toLowerCase()}`} />
                      </div>
                      <p className="border-t border-line bg-surface-2 px-2 py-1 text-[11px] text-fg-3">Sobre {COLOR_LABEL[k].toLowerCase()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </EditorSection>

          <EditorSection title="Ícone do navegador" description="O favicon aparece na aba do navegador, nos favoritos e no atalho do celular. Desenho simples, sem texto pequeno.">
            <div className="flex flex-wrap items-start gap-5">
              <ImageUpload
                label="Ícone"
                width={64}
                height={64}
                value={v.favicon}
                onChange={(url) => form.set('favicon', url)}
                disabled={!canEdit}
                previewClassName="w-28"
                hint="64×64 px"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[13px] font-medium text-fg">Na aba do navegador</p>
                <div className="flex max-w-[260px] items-center gap-2 rounded-t-lg border border-b-0 border-line bg-surface-2 px-3 py-2">
                  {v.favicon ? <img src={v.favicon} alt="" className="h-4 w-4 rounded-sm object-contain" /> : <span className="h-4 w-4 rounded-sm bg-line-strong" aria-hidden />}
                  <span className="truncate text-xs text-fg-2">{title}</span>
                </div>
                {!v.favicon && <p className="text-xs text-warning">Sem ícone, o navegador mostra um ícone genérico.</p>}
              </div>
            </div>
          </EditorSection>

          <EditorSection
            title="Cores"
            description="Escolha uma paleta pronta ou ajuste cada cor. O texto dos botões fica branco ou escuro automaticamente, o que der mais contraste."
          >
            <div>
              <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg">
                <SwatchBook size={15} className="text-fg-3" aria-hidden /> Paletas prontas
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {THEME_PRESETS.map((p) => {
                  const active = activePreset?.id === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        'rounded-xl border p-2 text-left transition-[border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                        active ? 'border-primary shadow-ring' : 'border-line hover:border-line-strong',
                      )}
                    >
                      <span className="relative block h-14 overflow-hidden rounded-lg ring-1 ring-inset ring-line" style={{ background: p.colors.background }} aria-hidden>
                        <span className="absolute inset-x-1.5 top-1.5 h-3.5 rounded" style={{ background: p.colors.surface }} />
                        <span className="absolute left-3 top-[11px] h-1 w-6 rounded-full" style={{ background: p.colors.text, opacity: 0.8 }} />
                        <span className="absolute bottom-2 left-2 h-3.5 w-11 rounded" style={{ background: p.colors.primary }} />
                        <span className="absolute bottom-2.5 left-[60px] h-2.5 w-2.5 rounded-full" style={{ background: p.colors.accent }} />
                        <span className="absolute bottom-3 right-2 h-1 w-8 rounded-full" style={{ background: p.colors.text, opacity: 0.55 }} />
                      </span>
                      <span className="mt-1.5 flex items-center justify-between gap-1 text-[12.5px] font-medium text-fg">
                        {p.name}
                        {active && <Check size={14} className="shrink-0 text-primary-text" aria-label="em uso" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <FormGrid>
              {COLOR_ORDER.map((k) => (
                <Field key={k} label={COLOR_LABEL[k]} htmlFor={`cor-${k}`} hint={COLOR_HINT[k]} error={isHex(v.colors[k]) ? null : 'Use o formato #RRGGBB.'}>
                  <ColorInput id={`cor-${k}`} value={v.colors[k]} onChange={(c) => setColor(k, c)} disabled={!canEdit} />
                </Field>
              ))}
              <Field label="Texto dos botões" hint="Automático: o que der mais contraste com a primária.">
                <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-fg-2">
                  <span className="h-5 w-5 rounded ring-1 ring-inset ring-line-strong" style={{ background: palette.onPrimary }} aria-hidden />
                  {bestTextOn(palette.primary) === '#FFFFFF' ? 'Branco' : 'Escuro'}
                </div>
              </Field>
            </FormGrid>

            <ContrastPanel checks={checks} failing={failingAny.length} />
            {failingText.length > 0 && (
              <Alert tone="warning" title={`${failingText.length} ${failingText.length === 1 ? 'combinação de texto está' : 'combinações de texto estão'} abaixo de 4,5:1`}>
                Texto com pouco contraste fica difícil de ler no celular e sob luz forte, e afasta jogadores com baixa visão. Ajuste as cores ou escolha uma paleta pronta.
              </Alert>
            )}
          </EditorSection>

          <EditorSection
            title="Imagem de compartilhamento"
            description="Aparece quando alguém envia o link do site no WhatsApp, Telegram ou redes sociais."
            aside={
              <p className="text-xs leading-5 text-fg-3">
                Título e descrição do link ficam em <TextLink to="/settings/seo">SEO avançado</TextLink>.
              </p>
            }
          >
            <ImageUpload
              label="Imagem"
              width={1200}
              height={630}
              value={v.shareImage}
              onChange={(url) => form.set('shareImage', url)}
              disabled={!canEdit}
              previewClassName="max-w-[420px]"
              hint="1200×630 px"
            />
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-fg">Como aparece numa conversa</p>
              <div className="max-w-[340px] rounded-2xl rounded-tl-sm border border-line bg-surface-2 p-1.5">
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  {v.shareImage ? (
                    <img src={v.shareImage} alt="Prévia da imagem de compartilhamento" className="aspect-[1200/630] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[1200/630] w-full items-center justify-center bg-surface-3 text-xs text-fg-3">Sem imagem</div>
                  )}
                  <div className="space-y-0.5 px-3 py-2">
                    <p className="truncate text-[13px] font-semibold text-fg">{title}</p>
                    <p className="line-clamp-2 text-xs leading-4 text-fg-3">{company.description}</p>
                    <p className="pt-0.5 text-[11px] uppercase tracking-wide text-fg-3">{SITE_DOMAIN}</p>
                  </div>
                </div>
                <p className="px-2 pb-0.5 pt-1.5 text-[13px] text-primary-text">https://{SITE_DOMAIN}</p>
              </div>
              {!v.shareImage && <p className="mt-2 text-xs text-warning">Sem imagem, o link aparece sem miniatura e chama menos atenção.</p>}
            </div>
          </EditorSection>
        </FormFieldset>
      </EditorLayout>

      <SaveBar form={form} />
    </>
  )
}

function ContrastPanel({ checks, failing }: { checks: ContrastCheck[]; failing: number }) {
  if (!checks.length) {
    return <Alert tone="neutral">Corrija as cores inválidas para ver o contraste.</Alert>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3.5 py-2.5">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Contrast size={15} className="text-fg-3" aria-hidden /> Contraste (WCAG 2.1)
        </p>
        <Badge tone={failing ? 'warning' : 'success'} dot>
          {failing ? `${failing} abaixo do mínimo` : 'Tudo legível'}
        </Badge>
      </div>
      <ul className="divide-y divide-line">
        {checks.map((c) => {
          const b = checkBadge(c)
          return (
            <li key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <span
                className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md text-[15px] font-bold ring-1 ring-inset ring-line"
                style={c.kind === 'interface' ? { background: c.bg } : { background: c.bg, color: c.fg }}
                aria-hidden
              >
                {c.kind === 'interface' ? <span className="h-3.5 w-7 rounded" style={{ background: c.fg }} /> : 'Aa'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">{c.label}</p>
                <p className="text-xs text-fg-3">
                  {c.hint} · mínimo {formatRatio(c.min)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-[13px] font-semibold text-fg tnum">{formatRatio(c.ratio)}</span>
                <Badge tone={b.tone}>{b.label}</Badge>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ThemePreview({ theme, title }: { theme: SiteTheme; title: string }) {
  const p = useMemo(() => sitePalette(theme.colors, DEFAULT_THEME.colors), [theme.colors])
  return (
    <BrowserFrame favicon={theme.favicon} title={title}>
      <div style={{ background: p.background }}>
        <SiteHeaderMock palette={p} logo={theme.logo} />
        <div className="space-y-3 p-3">
          <div
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5"
            style={{ background: `linear-gradient(115deg, ${rgba(p.primary, 0.38)}, ${rgba(p.primary, 0.06)})`, border: `1px solid ${rgba(p.primary, 0.35)}` }}
          >
            <div className="min-w-0">
              <span className="rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide" style={{ background: p.accent, color: p.onAccent }}>
                Bônus
              </span>
              <p className="mt-1 text-[12.5px] font-extrabold leading-tight" style={{ color: p.text }}>
                100% no 1º depósito
              </p>
              <p className="text-[9.5px]" style={{ color: p.muted }}>
                Até <strong style={{ color: p.accent }}>R$ 500,00</strong> para jogar
              </p>
            </div>
            <span className="shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
              Depositar
            </span>
          </div>

          <div
            className="mx-auto max-w-[250px] rounded-xl p-3.5"
            style={{ background: p.surface, border: `1px solid ${p.line}`, boxShadow: `0 10px 24px -12px ${rgba('#000000', 0.5)}` }}
          >
            <SiteLogo src={theme.logo} center className="mx-auto h-10 w-[84px]" style={{ color: p.text }} />
            <p className="mt-0.5 text-center text-[12px] font-bold" style={{ color: p.text }}>
              Entrar na sua conta
            </p>
            {['E-mail ou CPF', 'Senha'].map((ph) => (
              <div key={ph} className="mt-2 rounded-md px-2 py-1.5 text-[9.5px]" style={{ background: p.surface2, border: `1px solid ${p.line}`, color: p.muted }}>
                {ph}
              </div>
            ))}
            <p className="mt-1.5 text-right text-[9px] font-semibold" style={{ color: p.primary }}>
              Esqueci a senha
            </p>
            <div className="mt-2 rounded-md py-1.5 text-center text-[10.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
              Entrar
            </div>
            <p className="mt-2 text-center text-[9.5px]" style={{ color: p.muted }}>
              Não tem conta?{' '}
              <span className="font-bold" style={{ color: p.primary }}>
                Cadastre-se
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2.5" style={{ background: p.surface, borderTop: `1px solid ${p.line}` }}>
          <SiteLogo src={theme.logo} className="h-6 w-[48px] shrink-0" style={{ color: p.text }} />
          <span className="min-w-0 truncate text-[8.5px]" style={{ color: p.muted }}>
            Termos · Privacidade · Jogo responsável
          </span>
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[7.5px] font-extrabold"
            style={{ border: `1.5px solid ${p.muted}`, color: p.text }}
          >
            18+
          </span>
        </div>
      </div>
    </BrowserFrame>
  )
}
