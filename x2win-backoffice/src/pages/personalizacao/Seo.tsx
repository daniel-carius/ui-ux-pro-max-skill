import { useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Globe,
  ImageIcon,
  ImageOff,
  Link2,
  MoreVertical,
  Search,
  Tags,
  Type,
} from 'lucide-react'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormFieldset,
  FormGrid,
  ImageUpload,
  Input,
  PageHeader,
  Progress,
  SaveBar,
  Segmented,
  TagInput,
  Textarea,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  DEFAULT_SEO,
  P2_KEYS,
  SEO_LIMITS,
  hostOf,
  seoChecks,
  seoErrors,
  truncateSerp,
  validateSeo,
  type SeoSettings,
} from '@/data/personalizacao2-config'
import { safeImageSrc } from '@/domain/personalizacao-p1'
import { CharCount, DeviceToggle, initialDevice, LivePreview, SiteLogo, type Device } from './_shared-p2'
import { SafeImage } from './_shared-p1'

type PreviewKind = 'google' | 'whatsapp' | 'facebook'

const KEYWORD_SUGGESTIONS = ['cassino online', 'apostas esportivas', 'bet', 'fortune tiger', 'aviator', 'roleta ao vivo', 'saque pix', 'jogo do tigrinho', 'crash', 'bônus de boas-vindas']

export default function Seo() {
  const form = useSettingsForm<SeoSettings>(P2_KEYS.seo, DEFAULT_SEO, { entity: 'SEO avançado', validate: validateSeo, successMessage: 'SEO salvo' })
  const [kind, setKind] = useState<PreviewKind>('google')
  const [device, setDevice] = useState<Device>(initialDevice)
  const v = form.values
  const errors = seoErrors(v)
  const checks = seoChecks(v)
  const passed = checks.filter((c) => c.ok).length
  const titleLen = v.title.trim().length
  const descLen = v.description.trim().length
  const suggestions = KEYWORD_SUGGESTIONS.filter((k) => !v.keywords.includes(k))

  return (
    <>
      <PageHeader />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <FormFieldset readOnly={form.readOnly}>
          <Card>
            <CardHeader
              icon={CheckCircle2}
              title="Saúde do SEO"
              description="Boas práticas para o link aparecer bem no Google e nas redes. Não impede salvar."
              actions={<Badge tone={passed === checks.length ? 'success' : passed >= checks.length - 2 ? 'warning' : 'danger'} size="md">{`${passed} de ${checks.length}`}</Badge>}
            />
            <CardBody>
              <Progress value={passed} max={checks.length} tone={passed === checks.length ? 'success' : passed >= checks.length - 2 ? 'warning' : 'danger'} label="Itens de SEO atendidos" className="mb-4" />
              <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2.5">
                    {c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-label="Atendido" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-label="A melhorar" />}
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-fg">{c.label}</span>
                      <span className="block text-xs leading-5 text-fg-3">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Globe} title="Endereço e nome" description="Como o Google identifica o site principal." />
            <CardBody>
              <FormGrid>
                <Field label="Endereço canônico" htmlFor="seo-url" required error={errors.canonicalUrl} hint="Endereço oficial do site. Evita que cópias e links com parâmetros dividam a relevância.">
                  <Input id="seo-url" icon={Link2} value={v.canonicalUrl} placeholder="https://x2win.bet.br" inputMode="url" onChange={(e) => form.set('canonicalUrl', e.target.value)} invalid={!!errors.canonicalUrl} />
                </Field>
                <Field label="Nome do site" htmlFor="seo-name" required error={errors.siteName} labelAside={<CharCount count={v.siteName.length} max={SEO_LIMITS.siteName} />} hint="Aparece acima do título no Google e no cartão de compartilhamento.">
                  <Input id="seo-name" value={v.siteName} onChange={(e) => form.set('siteName', e.target.value)} invalid={!!errors.siteName} />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Type} title="Título e descrição" description="O texto do resultado de busca e do link compartilhado." />
            <CardBody className="space-y-4">
              <Field
                label="Título"
                htmlFor="seo-title"
                required
                error={errors.title}
                labelAside={<CharCount count={titleLen} max={SEO_LIMITS.title} min={SEO_LIMITS.titleMin} />}
                hint={
                  titleLen > SEO_LIMITS.title ? (
                    <span className="font-medium text-warning">Passou de {SEO_LIMITS.title} caracteres: o Google vai cortar o título com reticências.</span>
                  ) : (
                    `De ${SEO_LIMITS.titleMin} a ${SEO_LIMITS.title} caracteres, com o nome do site.`
                  )
                }
              >
                <Input id="seo-title" value={v.title} onChange={(e) => form.set('title', e.target.value)} invalid={!!errors.title} className={cn(titleLen > SEO_LIMITS.title && 'border-warning')} />
              </Field>
              <Field
                label="Descrição"
                htmlFor="seo-desc"
                required
                error={errors.description}
                labelAside={<CharCount count={descLen} max={SEO_LIMITS.description} min={SEO_LIMITS.descriptionMin} />}
                hint={
                  descLen > SEO_LIMITS.description ? (
                    <span className="font-medium text-warning">Passou de {SEO_LIMITS.description} caracteres: o final não aparece no Google.</span>
                  ) : (
                    `De ${SEO_LIMITS.descriptionMin} a ${SEO_LIMITS.description} caracteres. Diga o que o jogador encontra e inclua o aviso de 18+.`
                  )
                }
              >
                <Textarea id="seo-desc" rows={3} value={v.description} onChange={(e) => form.set('description', e.target.value)} invalid={!!errors.description} className={cn(descLen > SEO_LIMITS.description && 'border-warning')} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={ImageIcon} title="Imagens" description="Logotipo e ícone usados pelo Google; imagem que aparece ao compartilhar o link." />
            <CardBody className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <ImageUpload
                  label="Logotipo"
                  value={safeImageSrc(v.logo)}
                  onChange={(x) => form.set('logo', x)}
                  disabled={form.readOnly}
                  hint="Quadrado, mínimo 112×112 px."
                  minSquare={112}
                  previewClassName="h-32"
                />
                <ImageUpload
                  label="Ícone do navegador"
                  value={safeImageSrc(v.favicon)}
                  onChange={(x) => form.set('favicon', x)}
                  disabled={form.readOnly}
                  hint="PNG quadrado, 48×48 px ou maior."
                  minSquare={48}
                  previewClassName="h-32"
                />
              </div>
              <ImageUpload
                label="Imagem de compartilhamento"
                value={safeImageSrc(v.shareImage)}
                onChange={(x) => form.set('shareImage', x)}
                width={1200}
                height={630}
                disabled={form.readOnly}
                hint="1200×630 px. Aparece no WhatsApp, Facebook, X e Telegram."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={Tags}
              title="Palavras-chave"
              description="Termos que o jogador busca. Ajudam buscadores menores; o Google usa mais o título e a descrição."
              actions={<Badge tone={v.keywords.length > SEO_LIMITS.keywords ? 'warning' : 'neutral'}>{`${v.keywords.length} palavras`}</Badge>}
            />
            <CardBody className="space-y-3">
              <Field
                label="Palavras-chave"
                htmlFor="seo-kw"
                error={errors.keywords}
                hint={v.keywords.length > SEO_LIMITS.keywords ? <span className="font-medium text-warning">Mais de {SEO_LIMITS.keywords}: foque nas mais importantes.</span> : 'Tecle Enter ou vírgula para adicionar.'}
              >
                <TagInput id="seo-kw" value={v.keywords} onChange={(k) => form.set('keywords', k.map((x) => x.toLowerCase()))} disabled={form.readOnly} />
              </Field>
              {suggestions.length > 0 && !form.readOnly && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-fg-3">Sugestões</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => form.set('keywords', [...v.keywords, s])}
                        className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-fg-2 transition-colors hover:border-primary hover:text-primary-text"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </FormFieldset>

        <div className="min-w-0">
          <LivePreview
            dirty={form.dirty}
            description="Como o link aparece com o rascunho."
            actions={
              <Segmented<PreviewKind>
                size="sm"
                ariaLabel="Onde ver a prévia"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'google', label: 'Google' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'facebook', label: 'Facebook' },
                ]}
              />
            }
            footnote={kind === 'google' ? 'O Google pode reescrever título e descrição quando acha outro trecho mais útil para a busca.' : 'Redes guardam a prévia em cache: mudanças podem levar algumas horas para aparecer.'}
          >
            {kind === 'google' && (
              <>
                <div className="mb-3 flex justify-end">
                  <DeviceToggle value={device} onChange={setDevice} />
                </div>
                <GooglePreview v={v} mobile={device === 'mobile'} />
              </>
            )}
            {kind === 'whatsapp' && <WhatsAppPreview v={v} />}
            {kind === 'facebook' && <FacebookPreview v={v} />}
          </LivePreview>
        </div>
      </div>

      <SaveBar form={form} />
    </>
  )
}

// ---------- Prévias (cores do próprio Google, WhatsApp e Facebook) ----------

const G = { bg: '#ffffff', title: '#1a0dab', text: '#4d5156', url: '#202124', faint: '#70757a', line: '#dadce0' }

function Favicon({ src, size = 26 }: { src: string | null; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ width: size, height: size, background: '#f1f3f4', border: `1px solid ${G.line}` }}>
      <SafeImage src={src} style={{ width: size * 0.62, height: size * 0.62, objectFit: 'contain' }} fallback={<Globe size={size * 0.55} style={{ color: G.faint }} aria-hidden />} />
    </span>
  )
}

function GooglePreview({ v, mobile }: { v: SeoSettings; mobile: boolean }) {
  const host = hostOf(v.canonicalUrl)
  const title = truncateSerp(v.title || 'Sem título', SEO_LIMITS.title)
  const desc = truncateSerp(v.description || 'Sem descrição.', mobile ? 120 : SEO_LIMITS.description)
  const font: CSSProperties = { fontFamily: 'Arial, Helvetica, sans-serif' }
  return (
    <figure aria-label="Prévia do resultado no Google" className="m-0 overflow-hidden rounded-xl border border-line-strong/80" style={{ background: G.bg, ...font }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${G.line}` }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }} aria-hidden>
          <span style={{ color: '#4285F4' }}>G</span>
          <span style={{ color: '#EA4335' }}>o</span>
          <span style={{ color: '#FBBC05' }}>o</span>
          <span style={{ color: '#4285F4' }}>g</span>
          <span style={{ color: '#34A853' }}>l</span>
          <span style={{ color: '#EA4335' }}>e</span>
        </span>
        <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full px-3" style={{ border: `1px solid ${G.line}`, color: G.url, fontSize: 14 }}>
          <Search size={15} style={{ color: G.faint }} aria-hidden />
          <span className="truncate">{(v.siteName || host).toLowerCase()}</span>
        </span>
      </div>
      <div className="px-4 py-4" style={{ background: mobile ? '#f8f9fa' : undefined }}>
        <div className={cn(mobile && 'rounded-2xl p-4')} style={mobile ? { background: '#fff', boxShadow: '0 1px 6px rgba(32,33,36,0.18)', maxWidth: 380, marginInline: 'auto' } : undefined}>
          <div className="flex items-center gap-2.5">
            <Favicon src={v.favicon} />
            <div className="min-w-0 leading-tight">
              <p className="truncate" style={{ color: G.url, fontSize: 14 }}>
                {v.siteName || host}
              </p>
              <p className="truncate" style={{ color: G.faint, fontSize: 12 }}>
                {v.canonicalUrl.replace(/\/$/, '')}
              </p>
            </div>
            <MoreVertical size={16} style={{ color: G.faint, marginLeft: 'auto' }} aria-hidden />
          </div>
          <p style={{ color: G.title, fontSize: mobile ? 18 : 20, lineHeight: 1.3, marginTop: 8 }}>{title}</p>
          <p style={{ color: G.text, fontSize: 14, lineHeight: 1.58, marginTop: 4 }}>{desc}</p>
        </div>
      </div>
    </figure>
  )
}

function ShareImage({ v, ratio = '1200 / 630' }: { v: SeoSettings; ratio?: string }) {
  const empty = (
    <div className="flex w-full flex-col items-center justify-center gap-1.5" style={{ aspectRatio: ratio, background: 'repeating-linear-gradient(135deg,#e9edef 0 10px,#f2f4f5 10px 20px)', color: '#667781' }}>
      <ImageOff size={22} aria-hidden />
      <span style={{ fontSize: 12, fontWeight: 600 }}>Sem imagem de compartilhamento</span>
      <span style={{ fontSize: 11 }}>O link aparece sem foto</span>
    </div>
  )
  // só imagem enviada pelo painel (ou https); se não carregar, a mesma prévia sem foto
  return <SafeImage src={v.shareImage} alt="Imagem de compartilhamento" className="block w-full object-cover" style={{ aspectRatio: ratio }} fallback={empty} />
}

function WhatsAppPreview({ v }: { v: SeoSettings }) {
  const host = hostOf(v.canonicalUrl)
  return (
    <figure aria-label="Prévia do link no WhatsApp" className="m-0 overflow-hidden rounded-xl border border-line-strong/80" style={{ background: '#efeae2', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: '#008069', color: '#fff' }}>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ background: '#dfe5e7', color: '#008069', fontWeight: 700, fontSize: 13 }}>
          JP
        </span>
        <div className="leading-tight">
          <p style={{ fontSize: 14, fontWeight: 600 }}>João Pedro</p>
          <p style={{ fontSize: 11, opacity: 0.85 }}>online</p>
        </div>
      </div>
      <div className="flex justify-end px-3 py-5">
        <div className="w-[88%] max-w-[340px] rounded-lg p-1" style={{ background: '#d9fdd3', boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
          <div className="overflow-hidden rounded-md" style={{ background: '#d1f4cc' }}>
            <ShareImage v={v} />
            <div className="px-2.5 py-2">
              <p className="line-clamp-2" style={{ fontSize: 13.5, fontWeight: 600, color: '#111b21', lineHeight: 1.3 }}>
                {v.title || v.siteName}
              </p>
              <p className="line-clamp-2" style={{ fontSize: 12.5, color: '#667781', marginTop: 2, lineHeight: 1.35 }}>
                {v.description}
              </p>
              <p style={{ fontSize: 11.5, color: '#667781', marginTop: 4 }}>{host}</p>
            </div>
          </div>
          <p className="px-1.5 pb-0.5 pt-1.5" style={{ fontSize: 13.5, color: '#027eb5', wordBreak: 'break-all' }}>
            {v.canonicalUrl}
          </p>
          <p className="flex items-center justify-end gap-1 px-1.5" style={{ fontSize: 11, color: '#667781' }}>
            21:14 <CheckCheck size={14} style={{ color: '#53bdeb' }} aria-label="lida" />
          </p>
        </div>
      </div>
    </figure>
  )
}

function FacebookPreview({ v }: { v: SeoSettings }) {
  const host = hostOf(v.canonicalUrl)
  return (
    <figure aria-label="Prévia do link no Facebook" className="m-0 overflow-hidden rounded-xl border border-line-strong/80 p-4" style={{ background: '#f0f2f5', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div className="overflow-hidden rounded-lg" style={{ background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}>
        <div className="flex items-center gap-2.5 p-3">
          <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full" style={{ background: '#0B0A1A' }}>
            <SafeImage src={v.logo} className="h-full w-full object-cover" fallback={<SiteLogo name="" size={26} />} />
          </span>
          <div className="leading-tight">
            <p style={{ fontSize: 14, fontWeight: 600, color: '#050505' }}>{v.siteName || host}</p>
            <p style={{ fontSize: 12, color: '#65676b' }}>agora · Público</p>
          </div>
        </div>
        <p className="px-3 pb-3" style={{ fontSize: 14, color: '#050505' }}>
          Saque por PIX em minutos. Confira:
        </p>
        <ShareImage v={v} ratio="1.91 / 1" />
        <div className="px-3 py-2.5" style={{ background: '#f0f2f5', borderTop: '1px solid #e4e6eb' }}>
          <p className="uppercase" style={{ fontSize: 12, color: '#65676b' }}>
            {host}
          </p>
          <p className="truncate" style={{ fontSize: 16, fontWeight: 600, color: '#050505', marginTop: 2 }}>
            {v.title || v.siteName}
          </p>
          <p className="truncate" style={{ fontSize: 14, color: '#65676b' }}>
            {v.description}
          </p>
        </div>
      </div>
    </figure>
  )
}
