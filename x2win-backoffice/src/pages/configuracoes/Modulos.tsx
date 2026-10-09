import type { LucideIcon } from 'lucide-react'
import {
  Ban,
  Blocks,
  Clapperboard,
  Crown,
  Dices,
  FileX2,
  HandCoins,
  LayoutTemplate,
  Link2,
  LoaderPinwheel,
  Megaphone,
  Menu,
  Newspaper,
  PowerOff,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Target,
  Trophy,
  UsersRound,
  Volleyball,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, Badge, FormFieldset, KpiCard, PageHeader, SaveBar, Switch, confirm, useSettingsForm } from '@/components/ui'
import { BrandMark } from '@/components/layout/Brand'
import { cn } from '@/lib/cn'
import { audit } from '@/domain/session'
import {
  DEFAULT_MODULES,
  MODULES_KEY,
  MODULE_GROUP_LABEL,
  SITE_MODULES,
  moduleCounts,
  moduleImpact,
  modulesDiff,
  validateModules,
  type ModuleGroup,
  type ModulesState,
  type SiteModule,
  type SiteModuleId,
} from '@/domain/config1-modulos'
import { CheckRow, SitePreview } from './_shared-f'

const ICON: Record<SiteModuleId, LucideIcon> = {
  cassino: Dices,
  'cassino-ao-vivo': Clapperboard,
  esportes: Volleyball,
  promocoes: Megaphone,
  torneios: Trophy,
  missoes: Target,
  loja: ShoppingBag,
  roleta: LoaderPinwheel,
  indicacao: UsersRound,
  niveis: Crown,
  cashback: HandCoins,
  blog: Newspaper,
}

const IMPACT_ICON = { menu: Menu, home: LayoutTemplate, page: Link2 }

export default function Modulos() {
  const form = useSettingsForm<ModulesState>(MODULES_KEY, DEFAULT_MODULES, {
    entity: 'Módulos do site',
    successMessage: 'Módulos do site salvos',
    validate: validateModules,
    onSaved: (next, prev) => {
      const { turnedOff, turnedOn } = modulesDiff(prev, next)
      for (const m of turnedOff) audit('desligar', `Módulo ${m.name}`, moduleImpact(m).map((i) => i.label).join(' · '))
      for (const m of turnedOn) audit('ligar', `Módulo ${m.name}`, `Volta ao menu${m.homeBlock ? `, à home (bloco ${m.homeBlock})` : ''} e a página ${m.path} volta ao ar`)
    },
  })
  const v = form.values
  const c = moduleCounts(v)
  const pending = modulesDiff(form.saved, v)
  const err = validateModules(v)

  const toggle = async (m: SiteModule, next: boolean) => {
    if (!next) {
      const ok = await confirm({
        title: `Desligar ${m.name}?`,
        description: 'Ao salvar, a área sai do site de uma vez, para todos os jogadores:',
        confirmLabel: `Desligar ${m.name}`,
        tone: 'warning',
        icon: PowerOff,
        details: (
          <div className="space-y-3">
            <ul className="space-y-1.5 rounded-lg border border-line bg-surface-2 p-3">
              {moduleImpact(m).map((i) => (
                <CheckRow key={i.kind} icon={IMPACT_ICON[i.kind]} tone="danger">
                  {i.label}
                </CheckRow>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-[13px] leading-5 text-fg-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <span>
                <strong className="font-semibold text-fg">O que continua: </strong>
                {m.keeps}
              </span>
            </p>
          </div>
        ),
      })
      if (!ok) return
    }
    form.set(m.id, next)
  }

  const groups: ModuleGroup[] = ['jogos', 'engajamento', 'conteudo']

  return (
    <>
      <PageHeader />

      <Alert tone="info" title="Uma chave por área do site" className="mb-5">
        Desligar uma área remove, de uma vez, a entrada no menu, o bloco da página inicial e a própria página. Nada é apagado: ao religar, tudo volta como estava.
      </Alert>

      <section aria-label="Resumo das áreas" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Áreas ligadas" icon={Blocks} value={`${c.on} de ${c.total}`} hint="no rascunho atual" />
        <KpiCard label="Itens no menu" icon={Menu} tone="info" value={c.menu} hint="cabeçalho e barra do celular" />
        <KpiCard label="Blocos na home" icon={LayoutTemplate} tone="info" value={c.home} hint="ordem em Página inicial" />
        <KpiCard label="Páginas fora do ar" icon={FileX2} tone={c.total - c.pages ? 'warning' : 'success'} value={c.total - c.pages} hint="mostram “página indisponível”" />
      </section>

      {(pending.turnedOff.length > 0 || pending.turnedOn.length > 0) && (
        <Alert tone={err ? 'danger' : 'warning'} title={err ?? 'Mudanças valem ao salvar'} className="mb-5">
          {pending.turnedOff.length > 0 && (
            <>
              Saem do site: <strong className="text-fg">{pending.turnedOff.map((m) => m.name).join(', ')}</strong>.{' '}
            </>
          )}
          {pending.turnedOn.length > 0 && (
            <>
              Voltam ao site: <strong className="text-fg">{pending.turnedOn.map((m) => m.name).join(', ')}</strong>.
            </>
          )}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <FormFieldset readOnly={form.readOnly} className="space-y-6">
          {groups.map((g) => (
            <section key={g} aria-labelledby={`grp-${g}`}>
              <h2 id={`grp-${g}`} className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-fg-3">
                {MODULE_GROUP_LABEL[g]}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {SITE_MODULES.filter((m) => m.group === g).map((m) => (
                  <ModuleCard key={m.id} m={m} on={v[m.id]} changed={v[m.id] !== form.saved[m.id]} onToggle={(next) => toggle(m, next)} readOnly={form.readOnly} />
                ))}
              </div>
            </section>
          ))}
        </FormFieldset>

        <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
          <SitePreview url="x2win.bet.br" title="Prévia do site" description="Menu e página inicial com as áreas ligadas no rascunho.">
            <SiteMock state={v} />
          </SitePreview>
        </div>
      </div>

      <SaveBar form={form} />
    </>
  )
}

function ModuleCard({ m, on, changed, onToggle, readOnly }: { m: SiteModule; on: boolean; changed: boolean; onToggle: (v: boolean) => void; readOnly: boolean }) {
  const Icon = ICON[m.id]
  const impact = moduleImpact(m)
  return (
    <article className={cn('card flex flex-col p-4 transition-colors duration-150', !on && 'bg-surface-2', changed && 'border-warning/50')}>
      <div className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-primary/10 text-primary-text' : 'bg-surface-3 text-fg-3')}>
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold text-fg">{m.name}</h3>
            <Badge tone={on ? 'success' : 'neutral'} dot>
              {on ? 'No ar' : 'Desligado'}
            </Badge>
            {changed && <Badge tone="warning">Muda ao salvar</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{m.description}</p>
        </div>
        <Switch checked={on} onChange={onToggle} disabled={readOnly} ariaLabel={`${on ? 'Desligar' : 'Ligar'} ${m.name}`} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={on ? `${m.name} aparece em` : `${m.name} desligado`}>
        {impact.map((i) => {
          const I = IMPACT_ICON[i.kind]
          const text = i.kind === 'menu' ? `Menu: ${m.menuLabel}` : i.kind === 'home' ? `Home: ${m.homeBlock}` : m.path
          return (
            <li
              key={i.kind}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px]',
                on ? 'border-line bg-surface text-fg-2' : 'border-danger/20 bg-danger/5 text-danger line-through decoration-danger/50',
              )}
              title={on ? undefined : i.label}
            >
              <I size={11} className="shrink-0" aria-hidden />
              <span className={cn('truncate', i.kind === 'page' && 'font-mono')}>{text}</span>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs">
        <span className="text-fg-3">{on ? 'Ao desligar: sai do menu, da home e da página.' : 'Fora do menu, da home e da página.'}</span>
        {m.adminPath && (
          <Link to={m.adminPath} className="link inline-flex shrink-0 items-center gap-1">
            <Settings2 size={12} aria-hidden /> Configurar
          </Link>
        )}
      </div>
    </article>
  )
}

function SiteMock({ state }: { state: ModulesState }) {
  const on = SITE_MODULES.filter((m) => state[m.id])
  const off = SITE_MODULES.filter((m) => !state[m.id])
  const blocks = on.filter((m) => m.homeBlock)
  return (
    <div className="bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <BrandMark size={22} />
        <span className="font-display text-[13px] font-bold text-fg">X2Win</span>
        <span className="ml-auto flex gap-1" aria-hidden>
          <span className="h-5 w-11 rounded-md border border-line" />
          <span className="h-5 w-14 rounded-md bg-primary" />
        </span>
      </div>
      <nav aria-label="Menu do site (prévia)" className="flex flex-wrap gap-1 border-b border-line bg-surface-2 px-3 py-2">
        {on.map((m) => (
          <span key={m.id} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-2 ring-1 ring-line">
            {m.menuLabel}
          </span>
        ))}
        {on.length === 0 && <span className="text-[11px] text-fg-3">Menu vazio</span>}
      </nav>
      <div className="space-y-2 p-3">
        <div className="flex h-16 items-end rounded-lg bg-gradient-to-br from-primary/25 to-primary/5 p-2.5" aria-hidden>
          <span className="h-2 w-24 rounded bg-primary/40" />
        </div>
        {blocks.map((m) => {
          const Icon = ICON[m.id]
          return (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2">
              <Icon size={14} className="shrink-0 text-primary-text" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">{m.homeBlock}</span>
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-5 w-7 rounded bg-surface-3" />
                ))}
              </span>
            </div>
          )
        })}
      </div>
      {off.length > 0 && (
        <div className="border-t border-line bg-surface-2 px-3 py-2.5">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-fg-3">
            <Ban size={11} aria-hidden /> Fora do ar
          </p>
          <div className="flex flex-wrap gap-1">
            {off.map((m) => (
              <span key={m.id} className="rounded bg-danger/10 px-1.5 py-0.5 font-mono text-[10.5px] text-danger">
                {m.path}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
