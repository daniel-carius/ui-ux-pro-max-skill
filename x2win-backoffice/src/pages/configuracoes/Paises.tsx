import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowDownToLine, ArrowUpFromLine, Ban, Earth, Gamepad2, Lock, LogIn, Plane, Search, ShieldBan, Unlock, UserPlus } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  KpiCard,
  PageHeader,
  Select,
  confirm,
  confirmWithInput,
  normalize,
  toast,
} from '@/components/ui'
import { date, num } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCollection } from '@/lib/store'
import { COUNTRIES, COUNTRY_BY_CODE, PLATFORM_BLOCKED, blockedHits30d, seedBlockedCountries, type BlockedCountry } from '@/data/config1-paises'
import { isApiMode } from '@/lib/api'
import { NO_SOURCE_HINT } from '@/components/ui'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { BLOCKED_COUNTRIES_KEY, BLOCK_EFFECTS, HOME_COUNTRY, blockSource, canBlockCountry } from '@/domain/config1-paises'
import { BrowserFrame, CheckRow, IsoBadge } from './_shared-f'

const EFFECT_ICON: Record<(typeof BLOCK_EFFECTS)[number]['id'], LucideIcon> = {
  cadastro: UserPlus,
  login: LogIn,
  deposito: ArrowDownToLine,
  jogo: Gamepad2,
  saque: ArrowUpFromLine,
}

/** Modo API: acessos barrados vêm do site público, ainda não conectado (a contagem é só da demonstração). */
const HAS_HITS = !isApiMode()
const PLATFORM_CODES = PLATFORM_BLOCKED.map((p) => p.code)
const countryName = (code: string) => COUNTRY_BY_CODE.get(code)?.name ?? code

export default function Paises() {
  const blocked = useCollection<BlockedCountry>(BLOCKED_COUNTRIES_KEY, seedBlockedCountries)
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [listQuery, setListQuery] = useState('')
  const [query, setQuery] = useState('')
  const customCodes = blocked.items.map((b) => b.code)
  const [previewCode, setPreviewCode] = useState('AR')

  const totalHits = [...PLATFORM_CODES, ...customCodes].reduce((s, c) => s + blockedHits30d(c), 0)
  const noEdit = !canEdit ? 'Seu cargo pode ver, mas não alterar os países bloqueados.' : undefined

  const block = async (code: string) => {
    const check = canBlockCountry(code, PLATFORM_CODES, customCodes)
    if (!check.ok) {
      toast.error('Não foi possível bloquear', { description: check.message })
      return
    }
    const name = countryName(code)
    const r = await confirmWithInput({
      title: `Bloquear ${name}?`,
      description: 'Vale na hora para todo visitante que acessar a partir do país.',
      confirmLabel: 'Bloquear país',
      tone: 'danger',
      icon: Ban,
      details: <EffectList />,
      input: { label: 'Motivo', required: true, placeholder: 'Ex.: exige licença local' },
    })
    if (!r.confirmed) return
    blocked.add({ id: code, code, reason: r.value, createdAt: new Date().toISOString(), createdBy: user.name })
    audit('bloquear', `País ${code} · ${name}`, `Bloqueado: cadastro, login, depósito, jogo e saque. Motivo: ${r.value}`)
    toast.success(`${name} bloqueado`, { description: 'Visitantes do país passam a ver “não disponível no seu país”.' })
    setPreviewCode(code)
  }

  const unblock = async (b: BlockedCountry) => {
    const name = countryName(b.code)
    const ok = await confirm({
      title: `Desbloquear ${name}?`,
      description: 'Visitantes do país voltam a acessar cadastro, login, depósito, jogo e saque na hora.',
      confirmLabel: 'Desbloquear',
      tone: 'warning',
      icon: Unlock,
    })
    if (!ok) return
    blocked.remove(b.id)
    audit('excluir', `País ${b.code} · ${name}`, `Desbloqueado (estava bloqueado desde ${date(b.createdAt)})`)
    toast.success(`${name} desbloqueado`)
  }

  const lq = normalize(listQuery.trim())
  const matches = (code: string, extra = '') => !lq || normalize(`${code} ${countryName(code)} ${extra}`).includes(lq)
  const platformRows = PLATFORM_BLOCKED.filter((p) => matches(p.code, p.reason))
  const customRows = [...blocked.items].sort((a, b) => countryName(a.code).localeCompare(countryName(b.code))).filter((b) => matches(b.code, b.reason))

  const q = normalize(query.trim())
  const candidates = useMemo(
    () =>
      [...COUNTRIES]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .filter((c) => !q || normalize(`${c.code} ${c.name} ${c.region}`).includes(q)),
    [q],
  )

  return (
    <>
      <PageHeader />

      {!canEdit && (
        <Alert tone="neutral" className="mb-5">
          Seu cargo pode ver os países bloqueados, mas não bloquear nem desbloquear.
        </Alert>
      )}

      <section aria-label="Resumo dos bloqueios" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Países bloqueados" icon={Earth} tone="danger" value={num(PLATFORM_CODES.length + customCodes.length)} hint="regra da plataforma + operação" />
        <KpiCard label="Regra da plataforma" icon={Lock} tone="neutral" value={num(PLATFORM_CODES.length)} hint="fixos, não podem ser removidos" />
        <KpiCard label="Adicionados pela operação" icon={ShieldBan} tone="warning" value={num(customCodes.length)} hint="podem ser removidos aqui" />
        <KpiCard
          label="Acessos barrados"
          icon={Ban}
          tone="info"
          value={HAS_HITS ? num(totalHits) : '—'}
          hint={HAS_HITS ? 'nos últimos 30 dias (demonstração)' : NO_SOURCE_HINT}
          formula={
            HAS_HITS
              ? 'Tentativas de abrir o site a partir de um país bloqueado, identificadas pelo IP. Simulado nesta demonstração.'
              : 'Tentativas de abrir o site a partir de um país bloqueado, identificadas pelo IP. Vêm do site público, ainda não conectado a este painel.'
          }
        />
      </section>

      <Card className="mb-5">
        <CardHeader icon={ShieldBan} title="O que o bloqueio faz" description="Um país bloqueado barra tudo de uma vez. O visitante vê “não disponível no seu país”." />
        <CardBody>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {BLOCK_EFFECTS.map((e) => {
              const Icon = EFFECT_ICON[e.id]
              return (
                <li key={e.id} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                    <Icon size={16} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-fg">{e.label} bloqueado</p>
                    <p className="text-xs leading-5 text-fg-3">{e.detail}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-fg-3">
            <Plane size={14} className="mt-0.5 shrink-0" aria-hidden />
            Jogador brasileiro viajando para um país bloqueado também é barrado enquanto estiver lá. O saldo fica guardado e volta a ser usado no Brasil.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="min-w-0">
          <CardHeader
            icon={Ban}
            title="Países bloqueados"
            description="A lista da operação soma-se à regra da plataforma."
            actions={
              <div className="w-full sm:w-56">
                <Input icon={Search} aria-label="Filtrar países bloqueados" placeholder="Filtrar" value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
              </div>
            }
          />
          <CardBody className="space-y-5">
            <section aria-labelledby="pl-head">
              <h3 id="pl-head" className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-3">
                <Lock size={12} aria-hidden /> Regra da plataforma · {PLATFORM_BLOCKED.length}
              </h3>
              {platformRows.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {platformRows.map((p) => (
                    <li key={p.code} className="flex items-center gap-3 px-3 py-2.5">
                      <IsoBadge code={p.code} tone="danger" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-fg">{countryName(p.code)}</p>
                        <p className="truncate text-xs text-fg-3">{p.reason}</p>
                        {HAS_HITS && <p className="mt-0.5 text-[11px] text-fg-3 tnum sm:hidden">{num(blockedHits30d(p.code))} barrados em 30 dias</p>}
                      </div>
                      {HAS_HITS && <span className="hidden shrink-0 text-xs text-fg-3 tnum sm:inline">{num(blockedHits30d(p.code))} barrados</span>}
                      <Badge tone="neutral" icon={Lock} className="shrink-0">
                        <span className="hidden sm:inline">regra da plataforma</span>
                        <span className="sm:hidden">fixo</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-fg-3">Nenhum país da regra da plataforma corresponde ao filtro.</p>
              )}
            </section>

            <section aria-labelledby="op-head">
              <h3 id="op-head" className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-3">
                <ShieldBan size={12} aria-hidden /> Adicionados pela operação · {blocked.items.length}
              </h3>
              {customRows.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {customRows.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                      <IsoBadge code={b.code} tone="danger" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-fg">{countryName(b.code)}</p>
                        <p className="truncate text-xs text-fg-3">{b.reason}</p>
                        <p className="mt-0.5 truncate text-[11px] text-fg-3">
                          {b.createdBy}, {date(b.createdAt)}
                          {HAS_HITS && <span className="sm:hidden"> · {num(blockedHits30d(b.code))} barrados</span>}
                        </p>
                      </div>
                      {HAS_HITS && <span className="hidden shrink-0 text-xs text-fg-3 tnum sm:inline">{num(blockedHits30d(b.code))} barrados</span>}
                      <IconButton icon={Unlock} label={`Desbloquear ${countryName(b.code)}`} variant="danger" size="sm" disabled={!canEdit} title={noEdit} onClick={() => unblock(b)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed border-line">
                  <EmptyState
                    icon={Earth}
                    title={lq ? 'Nenhum país encontrado' : 'Nenhum país adicionado'}
                    description={lq ? 'Troque o filtro para ver outros países.' : 'Só a regra da plataforma está valendo. Use a busca ao lado para bloquear um país.'}
                    className="py-8"
                  />
                </div>
              )}
            </section>
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader icon={Search} title="Bloquear um país" description="Busque pelo nome ou pelo código ISO (ex.: AR)." />
            <CardBody>
              <Input icon={Search} aria-label="Buscar país" placeholder="Buscar país" value={query} onChange={(e) => setQuery(e.target.value)} />
              <ul className="mt-3 max-h-[340px] divide-y divide-line overflow-y-auto rounded-xl border border-line" aria-label="Países">
                {candidates.map((c) => {
                  const src = blockSource(c.code, PLATFORM_CODES, customCodes)
                  const home = c.code === HOME_COUNTRY
                  return (
                    <li key={c.code} className={cn('flex items-center gap-2.5 px-3 py-2', home && 'bg-primary/5')}>
                      <IsoBadge code={c.code} tone={src ? 'danger' : home ? 'primary' : 'neutral'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-fg">{c.name}</p>
                        <p className="truncate text-[11px] text-fg-3">{home ? 'Mercado da autorização: não pode ser bloqueado' : c.region}</p>
                      </div>
                      {src === 'plataforma' ? (
                        <Badge tone="neutral" icon={Lock}>
                          plataforma
                        </Badge>
                      ) : src === 'operacao' ? (
                        <Badge tone="danger" dot>
                          Bloqueado
                        </Badge>
                      ) : home ? (
                        <Badge tone="primary" icon={Lock}>
                          Protegido
                        </Badge>
                      ) : (
                        <Button size="xs" variant="secondary" icon={Ban} disabled={!canEdit} title={noEdit} onClick={() => block(c.code)}>
                          Bloquear
                        </Button>
                      )}
                    </li>
                  )
                })}
                {candidates.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fg-3">Nenhum país com “{query}”.</li>}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Earth} title="Prévia da página de bloqueio" description="O que o visitante vê ao abrir o site do país escolhido." />
            <CardBody className="space-y-3">
              <Field label="Simular acesso de" htmlFor="pv-country">
                <Select
                  id="pv-country"
                  value={previewCode}
                  onChange={setPreviewCode}
                  options={[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))}
                />
              </Field>
              <BlockPreview code={previewCode} blocked={!!blockSource(previewCode, PLATFORM_CODES, customCodes)} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}

function EffectList() {
  return (
    <ul className="space-y-1.5 rounded-lg border border-line bg-surface-2 p-3">
      {BLOCK_EFFECTS.map((e) => (
        <CheckRow key={e.id} icon={EFFECT_ICON[e.id]} tone="danger">
          <strong className="font-semibold text-fg">{e.label}:</strong> {e.detail}
        </CheckRow>
      ))}
    </ul>
  )
}

function BlockPreview({ code, blocked }: { code: string; blocked: boolean }) {
  const name = countryName(code)
  return (
    <BrowserFrame url="x2win.bet.br">
      {blocked ? (
        <div className="bg-surface px-5 py-7 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
            <Earth size={24} aria-hidden />
          </span>
          <p className="mt-3 font-display text-base font-bold text-fg">Não disponível no seu país</p>
          <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-5 text-fg-2">
            A X2Win não está disponível em {name}. Cadastro, login, depósito, jogo e saque ficam bloqueados enquanto o acesso for daí.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-fg-3">
            Acesso identificado em <IsoBadge code={code} className="h-5 w-8 text-[10px]" /> {name}
          </p>
          <p className="mt-3 text-[11px] text-fg-3">
            Mora no Brasil e está viajando? Seu saldo fica guardado. <span className="text-primary-text underline">Fale com o suporte</span>
          </p>
        </div>
      ) : (
        <div className="bg-surface px-5 py-6">
          <Alert tone="success" title={`${name}: acesso liberado`}>
            Este país não está bloqueado. O visitante vê o site normalmente.
          </Alert>
        </div>
      )}
    </BrowserFrame>
  )
}
