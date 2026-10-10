import { useEffect, useRef, useState } from 'react'
import {
  BadgeCheck,
  CircleAlert,
  Clock3,
  GitCompareArrows,
  Info,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Volleyball,
  Webhook,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardFooter,
  CopyButton,
  DescriptionList,
  Field,
  FormFieldset,
  FormGrid,
  Input,
  Mono,
  PageHeader,
  Progress,
  RadioCards,
  SaveBar,
  SecretField,
  Select,
  SettingsSection,
  Switch,
  confirm,
  secretFieldError,
  toast,
  useSettingsForm,
  type Tone,
} from '@/components/ui'
import { isApiMode } from '@/lib/api'
import { dateTime, num, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { DATA_KEYS, useAggregators, useProviders } from '@/data/hooks'
import { seedSportsbookCredentials, type Aggregator, type SportsbookCredentials } from '@/data/catalog'
import { CASSINO_KEYS, defaultSyncRules, providerOffers } from '@/data/cassino'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  aggregatorDestinationChanged,
  effectivePrecedence,
  isDestinationChangedError,
  planSync,
  saveCredentialsDirect,
  secretNeedsRetype,
  simulateConnection,
  validatePlatformId,
  type AggregatorId,
  type ConnectionResult,
  type SyncPlan,
  type SyncRules,
} from '@/domain/cassino'
import { AGGREGATOR_HUE, BrandMark } from './_shared'

const NO_EDIT = 'Seu cargo pode ver, mas não editar os agregadores'
const API = isApiMode()
const NOT_SAVED = 'Erro inesperado ao falar com o servidor. Tente de novo.'
/** outra pessoa gravou antes: a tela já recarregou o valor do servidor */
const conflictToast = () =>
  toast.warning('Outra pessoa alterou estes dados', { description: 'Carregamos a versão mais recente. Confira e salve de novo.', duration: 6000 })
const OFFERS = providerOffers()
const WEBHOOK_BASE = 'https://api.x2win.bet.br/webhooks'

type SecretsMeta = Record<string, { at: string; by: string }>
type SyncLog = Record<string, (SyncPlan & { at: string; by: string }) | undefined>

const STATUS: Record<Aggregator['status'], { label: string; tone: Tone }> = {
  conectado: { label: 'Conectado', tone: 'success' },
  erro: { label: 'Com erro', tone: 'danger' },
  nao_configurado: { label: 'Não configurado', tone: 'neutral' },
}

const SYNC_STEPS = ['Conectando ao agregador', 'Baixando o catálogo', 'Comparando com o catálogo atual', 'Aplicando precedência e regras', 'Concluído']

function secretHint(meta: SecretsMeta, key: string, pending: boolean) {
  if (pending) return 'Novo valor definido. Clique em "Salvar credenciais" para gravar.'
  const m = meta[key]
  return m ? `Trocado ${relative(m.at)} por ${m.by}. Só os 4 últimos caracteres aparecem.` : 'Cifrado no servidor. Só os 4 últimos caracteres aparecem.'
}

export default function Agregadores() {
  const { canEdit } = usePageAccess()
  const { items: aggregators } = useAggregators()
  const rules = useSettingsForm<SyncRules>(CASSINO_KEYS.aggregatorRules, defaultSyncRules, {
    entity: 'Regras de sincronização dos agregadores',
    successMessage: 'Regras de sincronização salvas',
    validate: (v) => {
      if (!Number.isInteger(v.autoSyncHour) || v.autoSyncHour < 0 || v.autoSyncHour > 23) return 'A hora da sincronização automática vai de 0 a 23.'
      return null
    },
  })

  return (
    <>
      <PageHeader />

      <Alert tone="info" icon={ShieldCheck} className="mb-5" title="Segredos nunca são revelados">
        API secret, Webhook secret e chaves privadas são cifrados no servidor. A tela mostra só os 4 últimos caracteres, para você conferir qual chave está em uso, e não tem botão de revelar,
        nem para o Superadmin. Para trocar, use “Substituir”: o valor novo vale depois de “Salvar credenciais”, e a troca fica na auditoria sem o valor. (Achado de auditoria nº 6.)
      </Alert>

      <div className="space-y-5">
        {aggregators.map((a) => (
          <AggregatorBlock key={a.id} aggregator={a} rules={rules.saved} canEdit={canEdit} />
        ))}
        <SportsbookBlock canEdit={canEdit} />
      </div>

      <h2 className="mb-3 mt-8 text-[17px] font-bold text-fg">Regras do catálogo</h2>
      <FormFieldset readOnly={rules.readOnly}>
        <PrecedenceSection rules={rules.values} onChange={(p) => rules.set('precedence', p)} aggregators={aggregators} />
        <SettingsSection
          title="Regras de sincronização"
          description="Como o catálogo do site muda quando um agregador manda jogos novos, repetidos ou retirados."
        >
          <Alert tone="warning" title="Confirmar com o time técnico">
            Estas regras ainda não foram verificadas no back-end de cada agregador (quais jogos entram e como os duplicados são tratados). Confirme com o time técnico antes de mudar em produção.
          </Alert>
          <Field label="Jogo duplicado (chega pelos dois agregadores)">
            <RadioCards
              name="Jogo duplicado"
              value={rules.values.duplicates}
              onChange={(v) => rules.set('duplicates', v)}
              options={[
                { value: 'prioridade', label: 'Manter o do agregador com prioridade', description: 'Segue a precedência por provedora. O jogador vê um jogo só.', badge: <Badge tone="success">Recomendado</Badge> },
                { value: 'manter_ambos', label: 'Manter os dois', description: 'O jogo aparece repetido no site, um de cada agregador.' },
              ]}
            />
          </Field>
          <Field label="Jogo novo no catálogo">
            <RadioCards
              name="Jogo novo no catálogo"
              value={rules.values.newGames}
              onChange={(v) => rules.set('newGames', v)}
              options={[
                { value: 'pausado', label: 'Entra pausado', description: 'Fica fora do site até alguém revisar capa e destaque em Jogos.', badge: <Badge tone="success">Recomendado</Badge> },
                { value: 'ativo', label: 'Entra ativo', description: 'Aparece no site na hora, com a capa gerada.' },
              ]}
            />
          </Field>
          <Field label="Jogo que saiu do catálogo do agregador">
            <RadioCards
              name="Jogo que saiu do catálogo"
              value={rules.values.removedGames}
              onChange={(v) => rules.set('removedGames', v)}
              options={[
                { value: 'pausar', label: 'Pausar o jogo', description: 'Some do site e o histórico continua nos relatórios.' },
                { value: 'manter', label: 'Manter como está', description: 'Continua no site. O jogador pode ver erro ao abrir.' },
              ]}
            />
          </Field>
          <Switch
            label="Sincronizar automaticamente todo dia"
            description={rules.values.autoSync ? `Roda às ${String(rules.values.autoSyncHour).padStart(2, '0')}:00, horário de Brasília, nos dois agregadores.` : 'Desligada: o catálogo só muda com “Sincronizar catálogo”.'}
            checked={rules.values.autoSync}
            onChange={(v) => rules.set('autoSync', v)}
          />
          {rules.values.autoSync && (
            <Field label="Horário" htmlFor="sync-hour" hint="Prefira a madrugada, quando há menos jogadores.">
              <Select
                id="sync-hour"
                className="max-w-[200px]"
                value={String(rules.values.autoSyncHour)}
                onChange={(v) => rules.set('autoSyncHour', Number(v))}
                options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
              />
            </Field>
          )}
        </SettingsSection>
      </FormFieldset>
      <SaveBar form={rules} label="Salvar regras" />
    </>
  )
}

// ---------- Bloco de cada agregador ----------

interface Draft {
  currentEnv: Aggregator['currentEnv']
  platformId: string
  apiSecret: string
  webhookSecret: string
}

function AggregatorBlock({ aggregator: a, rules, canEdit }: { aggregator: Aggregator; rules: SyncRules; canEdit: boolean }) {
  const { items: aggregators, update } = useAggregators()
  const { items: providers } = useProviders()
  const { user } = useSession()
  const [tests, setTests] = useDb<Record<string, ConnectionResult | undefined>>(CASSINO_KEYS.aggregatorTests, {})
  const [syncs, setSyncs] = useDb<SyncLog>(CASSINO_KEYS.aggregatorSyncs, {})
  const [meta, setMeta] = useDb<SecretsMeta>(CASSINO_KEYS.secretsMeta, {})
  const saved: Draft = { currentEnv: a.currentEnv, platformId: a.platformId, apiSecret: a.apiSecret, webhookSecret: a.webhookSecret }
  const [draft, setDraft] = useState<Draft>(saved)
  const [touched, setTouched] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  // 400 do servidor para o segredo mantido pela máscara (destino mudou)
  const [serverError, setServerError] = useState<string | null>(null)
  const [sync, setSync] = useState<{ pct: number; step: number } | null>(null)
  const attempt = useRef(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), [])

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const pidError = validatePlatformId(draft.platformId)
  const env = a.environments.find((e) => e.id === draft.currentEnv) ?? a.environments[0]
  const test = tests[a.id]
  const lastSync = syncs[a.id]
  const st = STATUS[a.status]
  const providerCount = providers.filter((p) => p.aggregatorId === a.id).length
  const busy = testing || !!sync || saving
  // ambiente ou Platform ID mudou: o segredo salvo (a máscara) não vale para o destino novo
  const destChanged = aggregatorDestinationChanged(draft, a)
  const needsNew = (f: 'apiSecret' | 'webhookSecret') => secretNeedsRetype(API, a[f], destChanged)
  const secretError = (f: 'apiSecret' | 'webhookSecret') => secretFieldError(draft[f], { requireNew: needsNew(f), saved: a[f] })
  const fieldServerError = (f: 'apiSecret' | 'webhookSecret') => (serverError && draft[f] === a[f] ? serverError : null)

  const syncBlocker = !canEdit
    ? NO_EDIT
    : !a.contracted
      ? 'Agregador não contratado.'
      : dirty
        ? 'Salve as credenciais antes de sincronizar.'
        : a.status === 'erro'
          ? 'A última conexão falhou. Teste a conexão antes de sincronizar.'
          : null

  const save = async () => {
    setTouched(true)
    if (!canEdit) return
    if (pidError) {
      toast.error('Revise o Platform ID', { description: pidError })
      return
    }
    const pendingSecret = secretError('apiSecret') ?? secretError('webhookSecret')
    if (pendingSecret) {
      toast.error('Digite os segredos de novo', { description: pendingSecret })
      return
    }
    if (draft.currentEnv !== a.currentEnv && draft.currentEnv === 'staging') {
      const ok = await confirm({
        title: `Usar o ambiente de staging na ${a.name}?`,
        description: 'O site passa a usar o catálogo de testes do agregador. Jogos podem sumir ou aparecer sem estar homologados. Use só em janela de manutenção.',
        confirmLabel: 'Trocar para staging',
        tone: 'warning',
      })
      if (!ok) return
    }
    const changed: string[] = []
    if (draft.currentEnv !== a.currentEnv) changed.push(`ambiente ${a.environments.find((e) => e.id === a.currentEnv)?.label} → ${env.label}`)
    if (draft.platformId !== a.platformId) changed.push('Platform ID')
    if (draft.apiSecret !== a.apiSecret) changed.push('API secret substituído')
    if (draft.webhookSecret !== a.webhookSecret) changed.push('Webhook secret substituído')
    if (API) {
      // grava direto para mostrar o 400 do servidor junto do segredo; o registro da troca só depois da confirmação
      setSaving(true)
      setServerError(null)
      const r = await saveCredentialsDirect<Aggregator[]>(
        DATA_KEYS.aggregators,
        aggregators,
        aggregators.map((x) => (x.id === a.id ? { ...x, ...draft } : x)),
      )
      setSaving(false)
      if (!r.ok) {
        if (r.conflict) return conflictToast()
        if (isDestinationChangedError(r.error)) setServerError(r.error!.message)
        toast.error('Credenciais não salvas', { description: r.error?.message ?? NOT_SAVED, duration: 6000 })
        return
      }
      // o servidor devolve os segredos mascarados: o rascunho passa a ser o salvo
      const fresh = r.value.find((x) => x.id === a.id)
      if (fresh) setDraft({ currentEnv: fresh.currentEnv, platformId: fresh.platformId, apiSecret: fresh.apiSecret, webhookSecret: fresh.webhookSecret })
    } else {
      update(a.id, { ...draft })
    }
    const now = new Date().toISOString()
    setMeta((m) => ({
      ...m,
      ...(draft.apiSecret !== a.apiSecret ? { [`${a.id}.apiSecret`]: { at: now, by: user.name } } : {}),
      ...(draft.webhookSecret !== a.webhookSecret ? { [`${a.id}.webhookSecret`]: { at: now, by: user.name } } : {}),
    }))
    setTests((t) => ({ ...t, [a.id]: undefined }))
    audit('editar', `Agregador ${a.name}`, `Credenciais atualizadas: ${changed.join('; ')}`)
    toast.success('Credenciais salvas', { description: 'Cifradas no servidor. Teste a conexão para conferir.' })
  }

  const runTest = () => {
    if (!canEdit) return
    setTesting(true)
    attempt.current++
    const res = simulateConnection({ id: a.id, env: draft.currentEnv, platformId: draft.platformId, secrets: [draft.apiSecret, draft.webhookSecret], attempt: attempt.current })
    timers.current.push(
      window.setTimeout(() => {
        setTesting(false)
        setTests((t) => ({ ...t, [a.id]: res }))
        // só muda o status salvo se o teste foi com as credenciais salvas
        if (!dirty) update(a.id, { status: res.ok ? 'conectado' : 'erro' })
        audit('testar', `Agregador ${a.name}`, `Teste de conexão em ${res.env}${dirty ? ' (credenciais não salvas)' : ''}: ${res.ok ? `ok em ${res.latencyMs} ms` : `falhou (${res.code})`}`)
        if (res.ok) toast.success(`${a.name} respondeu em ${res.latencyMs} ms`, { description: res.message })
        else toast.error(`Falha na conexão com a ${a.name}`, { description: `${res.code} · ${res.message}` })
      }, 500 + res.latencyMs * 3),
    )
  }

  const runSync = async () => {
    if (syncBlocker) {
      toast.error('Não dá para sincronizar agora', { description: syncBlocker })
      return
    }
    attempt.current++
    const plan = planSync(a, rules, OFFERS, attempt.current)
    const ok = await confirm({
      title: `Sincronizar o catálogo da ${a.name}?`,
      description: 'O catálogo do site é atualizado com o que o agregador entrega agora, seguindo as regras abaixo. A sincronização leva alguns segundos e não derruba jogos em andamento.',
      confirmLabel: 'Sincronizar agora',
      icon: RefreshCw,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Jogos esperados', value: `cerca de ${num(plan.received)}` },
            { label: 'Jogos novos entram', value: rules.newGames === 'pausado' ? 'Pausados' : 'Ativos' },
            { label: 'Duplicados', value: rules.duplicates === 'prioridade' ? 'Fica o da prioridade' : 'Mantém os dois' },
            { label: 'Retirados pelo agregador', value: rules.removedGames === 'pausar' ? 'São pausados' : 'Ficam como estão' },
          ]}
        />
      ),
    })
    if (!ok) return
    setSync({ pct: 0, step: 0 })
    const total = 3200
    const tick = 160
    let elapsed = 0
    const run = () => {
      elapsed += tick
      const pct = Math.min(100, Math.round((elapsed / total) * 100))
      const step = Math.min(SYNC_STEPS.length - 1, Math.floor((pct / 100) * (SYNC_STEPS.length - 1)))
      setSync({ pct, step })
      if (pct < 100) {
        timers.current.push(window.setTimeout(run, tick))
        return
      }
      const at = new Date().toISOString()
      update(a.id, { lastSyncAt: at, lastSyncGames: plan.received, status: 'conectado' })
      setSyncs((s) => ({ ...s, [a.id]: { ...plan, at, by: user.name } }))
      audit(
        'sincronizar',
        `Agregador ${a.name}`,
        `${plan.received} jogos recebidos; ${plan.newGames} novos (${plan.newGamesStatus === 'pausado' ? 'entraram pausados' : 'entraram ativos'}); ${plan.duplicates} duplicados resolvidos; ${plan.removed} pausados por saírem do catálogo`,
      )
      toast.success(`Catálogo da ${a.name} sincronizado`, {
        description: `${num(plan.received)} jogos · ${plan.newGames} novos ${plan.newGamesStatus === 'pausado' ? 'entraram pausados' : 'já estão no site'}.`,
      })
      timers.current.push(window.setTimeout(() => setSync(null), 900))
    }
    timers.current.push(window.setTimeout(run, tick))
  }

  const webhookUrl = `${WEBHOOK_BASE}/${a.id}`

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark name={a.name} hue={AGGREGATOR_HUE[a.id] ?? 200} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-semibold text-fg">{a.name}</h3>
              <Badge tone={a.contracted ? 'primary' : 'neutral'} icon={a.contracted ? BadgeCheck : undefined}>
                {a.contracted ? 'Contratado' : 'Não contratado'}
              </Badge>
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-fg-3">
              {providerCount} provedoras · {num(a.lastSyncGames)} jogos no último catálogo · {a.environments.length > 1 ? `${a.environments.length} ambientes` : 'só produção'}
            </p>
          </div>
        </div>
        <div className="text-[13px] sm:text-right">
          <p className="flex items-center gap-1.5 text-fg-2 sm:justify-end">
            <Clock3 size={14} className="text-fg-3" aria-hidden />
            Sincronizado <strong className="font-semibold text-fg">{relative(a.lastSyncAt)}</strong>
          </p>
          <p className="text-xs text-fg-3">{a.lastSyncAt ? dateTime(a.lastSyncAt) : 'Nunca sincronizado'}</p>
        </div>
      </div>

      {sync && (
        <div className="mx-5 mb-4 rounded-xl border border-primary/25 bg-primary/5 p-3.5" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
            <span className="flex items-center gap-2 font-medium text-fg">
              <RefreshCw size={14} className={cn('text-primary-text', sync.pct < 100 && 'animate-spin')} aria-hidden />
              {SYNC_STEPS[sync.step]}
            </span>
            <span className="font-semibold text-fg tnum">{sync.pct}%</span>
          </div>
          <Progress value={sync.pct} tone={sync.pct === 100 ? 'success' : 'primary'} label={`Sincronização ${sync.pct}%`} />
        </div>
      )}

      <div className="border-t border-line px-5 py-5">
        <FormFieldset readOnly={!canEdit}>
          <FormGrid>
            <Field
              label="Ambiente"
              htmlFor={`${a.id}-env`}
              hint={a.environments.length === 1 ? 'Só o ambiente de produção está contratado.' : draft.currentEnv === 'staging' ? 'Staging é o ambiente de testes do agregador.' : 'O site usa este ambiente.'}
            >
              <Select
                id={`${a.id}-env`}
                value={draft.currentEnv}
                disabled={a.environments.length === 1}
                onChange={(v) => setDraft((d) => ({ ...d, currentEnv: v as Draft['currentEnv'] }))}
                options={a.environments.map((e) => ({ value: e.id, label: e.id === a.currentEnv ? `${e.label} (atual)` : e.label }))}
              />
            </Field>
            <Field label="Platform ID" htmlFor={`${a.id}-pid`} required error={touched || draft.platformId !== a.platformId ? pidError : null} hint="Identificador da X2Win no agregador.">
              <Input
                id={`${a.id}-pid`}
                value={draft.platformId}
                onChange={(e) => setDraft((d) => ({ ...d, platformId: e.target.value.trim() }))}
                className="font-mono"
                autoComplete="off"
                invalid={!!pidError && (touched || draft.platformId !== a.platformId)}
              />
            </Field>
            <SecretField
              label="API secret"
              value={draft.apiSecret}
              saved={a.apiSecret}
              requireNew={needsNew('apiSecret')}
              error={fieldServerError('apiSecret')}
              disabled={!canEdit}
              onChange={(v) => setDraft((d) => ({ ...d, apiSecret: v }))}
              hint={secretHint(meta, `${a.id}.apiSecret`, draft.apiSecret !== a.apiSecret)}
            />
            <SecretField
              label="Webhook secret"
              value={draft.webhookSecret}
              saved={a.webhookSecret}
              requireNew={needsNew('webhookSecret')}
              error={fieldServerError('webhookSecret')}
              disabled={!canEdit}
              onChange={(v) => setDraft((d) => ({ ...d, webhookSecret: v }))}
              hint={secretHint(meta, `${a.id}.webhookSecret`, draft.webhookSecret !== a.webhookSecret)}
            />
          </FormGrid>
        </FormFieldset>

        <div className="mt-5 grid gap-3 rounded-xl bg-surface-2 p-3.5 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-3">Endereço da API ({env.label})</p>
            <div className="mt-1 flex items-center gap-1">
              <Mono className="truncate">{env.baseUrl}</Mono>
              <CopyButton value={env.baseUrl} label="Copiar endereço da API" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-medium text-fg-3">
              <Webhook size={12} aria-hidden /> Webhook para cadastrar no agregador
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Mono className="truncate">{webhookUrl}</Mono>
              <CopyButton value={webhookUrl} label="Copiar URL do webhook" />
            </div>
          </div>
        </div>

        {draft.currentEnv === 'staging' && (
          <Alert tone="warning" className="mt-4" title="Ambiente de testes">
            Em staging, o catálogo e as rodadas não são reais. Volte para produção depois dos testes.
          </Alert>
        )}

        {lastSync && (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
            <span className="font-medium text-fg">Última sincronização pelo painel:</span>
            <span>{num(lastSync.received)} recebidos</span>
            <span>{lastSync.newGames} novos ({lastSync.newGamesStatus === 'pausado' ? 'pausados' : 'ativos'})</span>
            <span>{lastSync.duplicates} duplicados resolvidos</span>
            <span>{lastSync.removed} retirados</span>
            <span className="text-fg-3">
              {relative(lastSync.at)} por {lastSync.by}
            </span>
          </p>
        )}
      </div>

      <CardFooter className="justify-between">
        <div className="min-h-[28px] text-[13px]" aria-live="polite">
          {testing ? (
            <span className="text-fg-3">Testando conexão em {env.label}…</span>
          ) : test ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={test.ok ? 'success' : 'danger'} icon={test.ok ? Plug : CircleAlert} size="md">
                {test.ok ? `Conectado · ${test.latencyMs} ms` : `Falhou · ${test.code}`}
              </Badge>
              <span className="text-xs text-fg-3">
                {test.ok ? test.env : test.message} · {relative(test.at)}
              </span>
            </span>
          ) : (
            <span className="text-xs text-fg-3">Sem teste de conexão recente.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={Plug} onClick={runTest} loading={testing} disabled={!canEdit || busy} title={!canEdit ? NO_EDIT : dirty ? 'Testa os valores da tela, mesmo sem salvar' : undefined}>
            Testar conexão
          </Button>
          <Button icon={RefreshCw} onClick={runSync} disabled={busy || !!syncBlocker} title={syncBlocker ?? undefined}>
            Sincronizar catálogo
          </Button>
          <Button variant="primary" icon={Save} onClick={save} loading={saving} disabled={!canEdit || !dirty || busy} title={!canEdit ? NO_EDIT : undefined}>
            Salvar credenciais
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

// ---------- Sportsbook (Betby) ----------

function SportsbookBlock({ canEdit }: { canEdit: boolean }) {
  const { user } = useSession()
  const [saved, setSaved] = useDb<SportsbookCredentials>(CASSINO_KEYS.sportsbook, seedSportsbookCredentials)
  const [test, setTest] = useDb<ConnectionResult | null>(CASSINO_KEYS.sportsbookTest, null)
  const [meta, setMeta] = useDb<SecretsMeta>(CASSINO_KEYS.secretsMeta, {})
  const [draft, setDraft] = useState(saved)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const attempt = useRef(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const pidError = validatePlatformId(draft.platformId)
  const pubError = draft.publicKey.trim().length < 8 ? 'A chave pública tem pelo menos 8 caracteres.' : null
  // Platform ID mudou: os segredos salvos (a máscara) não valem para o destino novo
  const destChanged = draft.platformId.trim() !== saved.platformId.trim()
  const needsNew = (f: 'privateKey' | 'webhookSecret') => secretNeedsRetype(API, saved[f], destChanged)
  const secretError = (f: 'privateKey' | 'webhookSecret') => secretFieldError(draft[f], { requireNew: needsNew(f), saved: saved[f] })
  const fieldServerError = (f: 'privateKey' | 'webhookSecret') => (serverError && draft[f] === saved[f] ? serverError : null)

  const save = async () => {
    if (!canEdit || saving) return
    if (pidError || pubError) {
      toast.error('Revise os campos do sportsbook', { description: pidError ?? pubError ?? '' })
      return
    }
    const pendingSecret = secretError('privateKey') ?? secretError('webhookSecret')
    if (pendingSecret) {
      toast.error('Digite os segredos de novo', { description: pendingSecret })
      return
    }
    const changed: string[] = []
    if (draft.platformId !== saved.platformId) changed.push('Platform ID')
    if (draft.publicKey !== saved.publicKey) changed.push('Public API key')
    if (draft.privateKey !== saved.privateKey) changed.push('Private API key substituída')
    if (draft.webhookSecret !== saved.webhookSecret) changed.push('Webhook secret substituído')
    if (API) {
      setSaving(true)
      setServerError(null)
      const r = await saveCredentialsDirect<SportsbookCredentials>(CASSINO_KEYS.sportsbook, saved, draft)
      setSaving(false)
      if (!r.ok) {
        if (r.conflict) return conflictToast()
        if (isDestinationChangedError(r.error)) setServerError(r.error!.message)
        toast.error('Credenciais não salvas', { description: r.error?.message ?? NOT_SAVED, duration: 6000 })
        return
      }
      // o servidor devolve os segredos mascarados: o rascunho passa a ser o salvo
      setDraft(r.value)
    } else {
      setSaved(draft)
    }
    const now = new Date().toISOString()
    setMeta((m) => ({
      ...m,
      ...(draft.privateKey !== saved.privateKey ? { 'betby.privateKey': { at: now, by: user.name } } : {}),
      ...(draft.webhookSecret !== saved.webhookSecret ? { 'betby.webhookSecret': { at: now, by: user.name } } : {}),
    }))
    setTest(null)
    audit('editar', 'Sportsbook Betby', `Credenciais atualizadas: ${changed.join('; ')}`)
    toast.success('Credenciais do sportsbook salvas', { description: 'Teste a conexão para conferir.' })
  }

  const runTest = () => {
    if (!canEdit) return
    setTesting(true)
    attempt.current++
    const res = simulateConnection({ id: 'betby', env: 'producao', platformId: draft.platformId, secrets: [draft.publicKey, draft.privateKey, draft.webhookSecret], attempt: attempt.current })
    window.setTimeout(() => {
      setTesting(false)
      setTest(res)
      if (!dirty) setSaved((s) => ({ ...s, status: res.ok ? 'conectado' : 'erro' }))
      audit('testar', 'Sportsbook Betby', `Teste de conexão: ${res.ok ? `ok em ${res.latencyMs} ms` : `falhou (${res.code})`}`)
      if (res.ok) toast.success(`Betby respondeu em ${res.latencyMs} ms`)
      else toast.error('Falha na conexão com a Betby', { description: res.message })
    }, 500 + res.latencyMs * 3)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark name="Betby" hue={AGGREGATOR_HUE.betby} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-semibold text-fg">Betby</h3>
              <Badge tone="info" icon={Volleyball}>
                Sportsbook
              </Badge>
              {/* modo API sem nada gravado: credenciais em branco, ainda não é erro */}
              {saved.platformId ? (
                <Badge tone={saved.status === 'conectado' ? 'success' : 'danger'} dot>
                  {saved.status === 'conectado' ? 'Conectado' : 'Com erro'}
                </Badge>
              ) : (
                <Badge dot>Não configurado</Badge>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-fg-3">Apostas esportivas. Tem campos próprios e não tem catálogo para sincronizar.</p>
          </div>
        </div>
      </div>
      <div className="border-t border-line px-5 py-5">
        <FormFieldset readOnly={!canEdit}>
          <FormGrid>
            <Field label="Platform ID" htmlFor="sb-pid" required error={draft.platformId !== saved.platformId ? pidError : null}>
              <Input id="sb-pid" value={draft.platformId} className="font-mono" autoComplete="off" onChange={(e) => setDraft((d) => ({ ...d, platformId: e.target.value.trim() }))} invalid={!!pidError && draft.platformId !== saved.platformId} />
            </Field>
            <Field label="Public API key" htmlFor="sb-pub" required error={draft.publicKey !== saved.publicKey ? pubError : null} hint="Chave pública: usada no navegador do jogador, por isso aparece inteira.">
              <Input id="sb-pub" value={draft.publicKey} className="font-mono" autoComplete="off" onChange={(e) => setDraft((d) => ({ ...d, publicKey: e.target.value.trim() }))} invalid={!!pubError && draft.publicKey !== saved.publicKey} />
            </Field>
            <SecretField
              label="Private API key"
              value={draft.privateKey}
              saved={saved.privateKey}
              requireNew={needsNew('privateKey')}
              error={fieldServerError('privateKey')}
              disabled={!canEdit}
              onChange={(v) => setDraft((d) => ({ ...d, privateKey: v }))}
              hint={secretHint(meta, 'betby.privateKey', draft.privateKey !== saved.privateKey)}
            />
            <SecretField
              label="Webhook secret"
              value={draft.webhookSecret}
              saved={saved.webhookSecret}
              requireNew={needsNew('webhookSecret')}
              error={fieldServerError('webhookSecret')}
              disabled={!canEdit}
              onChange={(v) => setDraft((d) => ({ ...d, webhookSecret: v }))}
              hint={secretHint(meta, 'betby.webhookSecret', draft.webhookSecret !== saved.webhookSecret)}
            />
          </FormGrid>
        </FormFieldset>
        <div className="mt-5 rounded-xl bg-surface-2 p-3.5">
          <p className="flex items-center gap-1 text-xs font-medium text-fg-3">
            <Webhook size={12} aria-hidden /> Webhook para cadastrar na Betby
          </p>
          <div className="mt-1 flex items-center gap-1">
            <Mono className="truncate">{`${WEBHOOK_BASE}/betby`}</Mono>
            <CopyButton value={`${WEBHOOK_BASE}/betby`} label="Copiar URL do webhook" />
          </div>
        </div>
      </div>
      <CardFooter className="justify-between">
        <div className="min-h-[28px] text-[13px]" aria-live="polite">
          {testing ? (
            <span className="text-fg-3">Testando conexão…</span>
          ) : test ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={test.ok ? 'success' : 'danger'} icon={test.ok ? Plug : CircleAlert} size="md">
                {test.ok ? `Conectado · ${test.latencyMs} ms` : `Falhou · ${test.code}`}
              </Badge>
              <span className="text-xs text-fg-3">{relative(test.at)}</span>
            </span>
          ) : (
            <span className="text-xs text-fg-3">Sem teste de conexão recente.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={Plug} onClick={runTest} loading={testing} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
            Testar conexão
          </Button>
          <Button variant="primary" icon={Save} onClick={save} loading={saving} disabled={!canEdit || !dirty || testing} title={!canEdit ? NO_EDIT : undefined}>
            Salvar credenciais
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

// ---------- Precedência por provedora ----------

function PrecedenceSection({ rules, onChange, aggregators }: { rules: SyncRules; onChange: (p: SyncRules['precedence']) => void; aggregators: Aggregator[] }) {
  const { items: providers } = useProviders()
  const { canEdit } = usePageAccess()
  const name = (id: AggregatorId) => aggregators.find((a) => a.id === id)?.name ?? id
  const rows = [...providers].sort((a, b) => (OFFERS[b.id]?.length ?? 0) - (OFFERS[a.id]?.length ?? 0) || a.name.localeCompare(b.name))
  const shared = rows.filter((p) => (OFFERS[p.id]?.length ?? 0) > 1)
  const setAll = (id: AggregatorId) => onChange({ ...rules.precedence, ...Object.fromEntries(shared.map((p) => [p.id, id])) })

  return (
    <SettingsSection
      title="Precedência por provedora"
      description="Quando a mesma provedora chega pelos dois agregadores, o jogo do agregador com prioridade fica no site e o outro é ignorado."
      aside={
        <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-[12.5px] leading-5 text-fg-2">
          <GitCompareArrows size={15} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
          <span>
            <strong className="text-fg">{shared.length} provedoras</strong> chegam pelos dois agregadores. As outras têm um só caminho.
          </span>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-fg-2">Dar prioridade em todas as duplicadas:</span>
        {aggregators.map((a) => (
          <Button key={a.id} size="sm" variant="soft" onClick={() => setAll(a.id)} disabled={!canEdit}>
            {a.name}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Agregador com prioridade por provedora</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2/80 text-left text-xs font-semibold text-fg-3">
              <th scope="col" className="h-10 px-4">
                Provedora
              </th>
              <th scope="col" className="h-10 px-3">
                Entregue por
              </th>
              <th scope="col" className="h-10 w-56 px-4">
                Prioridade
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const offered = OFFERS[p.id] ?? [p.aggregatorId]
              const eff = effectivePrecedence(p.id, rules, OFFERS)
              return (
                <tr key={p.id} className="border-b border-line/70 last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2.5">
                      <BrandMark name={p.name} hue={p.logoHue} size={26} className="rounded-md" />
                      <span className="font-medium text-fg">{p.name}</span>
                      {p.status === 'pausada' && <Badge tone="warning">Pausada</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {offered.map((id) => (
                        <Badge key={id} tone={id === eff ? 'primary' : 'neutral'}>
                          {name(id)}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {offered.length > 1 ? (
                      <Select
                        aria-label={`Agregador com prioridade para ${p.name}`}
                        value={eff ?? ''}
                        onChange={(v) => onChange({ ...rules.precedence, [p.id]: v as AggregatorId })}
                        options={offered.map((id) => ({ value: id, label: name(id) }))}
                        className="[&_select]:h-9"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5 text-[13px] text-fg-3">
                        <Info size={13} aria-hidden /> Só {name(offered[0])}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  )
}
