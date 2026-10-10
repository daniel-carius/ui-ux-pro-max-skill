import { useState } from 'react'
import { Activity, Globe, History, LockKeyhole, Network, RefreshCw, Server, ShieldCheck, UserCog } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  DataTable,
  DescriptionList,
  KpiCard,
  Mono,
  PageHeader,
  Progress,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { date, dateTime, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { dbSetAndWait, useDb } from '@/lib/store'
import { ACCESS_HOSTS, DOMAIN_CHECKS_KEY, MAIN_DOMAIN, seedDomainChecks, simulateCheck, type AccessHost, type DomainCheck, type HostResult } from '@/data/config1-dominios'
import { audit, useSession } from '@/domain/session'
import { SLOW_MS, daysLeft, hostLevel, sslState, type HostLevel } from '@/domain/config1-dominios'

const LEVEL_TONE: Record<HostLevel, Tone> = { ok: 'success', lento: 'warning', fora: 'danger' }
const LEVEL_LABEL: Record<HostLevel, string> = { ok: 'Online', lento: 'Lento', fora: 'Fora do ar' }
const SSL_TERM_DAYS = 90

type Row = AccessHost & { result?: HostResult }

/**
 * Modo API: o histórico vem só do servidor (sem verificações de demonstração). A tela inclui a verificação nova
 * no começo da lista gravada ([nova, ...gravadas].slice(0, 12)); o servidor define id, data e autor e recusa
 * trocar ou apagar as anteriores.
 */
const CHECKS_SEED: () => DomainCheck[] = isApiMode() ? () => [] : seedDomainChecks

export default function Dominios() {
  const [checks] = useDb<DomainCheck[]>(DOMAIN_CHECKS_KEY, CHECKS_SEED)
  const { user } = useSession()
  const [running, setRunning] = useState(false)
  const last = checks[0]
  const ssl = sslState(MAIN_DOMAIN.ssl.validUntil, MAIN_DOMAIN.ssl.autoRenewDaysBefore)
  const okCount = last ? last.results.filter((r) => hostLevel(r) !== 'fora').length : 0
  const regDays = daysLeft(MAIN_DOMAIN.expiresAt)

  const runCheck = () => {
    setRunning(true)
    setTimeout(async () => {
      const now = new Date()
      const c = simulateCheck(now.getTime() % 100_000, now, user.name)
      // espera o servidor (modo demonstração: na hora); recusada, o motivo já apareceu
      const ok = await dbSetAndWait<DomainCheck[]>(DOMAIN_CHECKS_KEY, (prev) => [c, ...prev].slice(0, 12), CHECKS_SEED)
      if (!ok) {
        setRunning(false)
        return
      }
      const up = c.results.filter((r) => hostLevel(r) !== 'fora').length
      const slow = c.results.filter((r) => hostLevel(r) === 'lento').length
      audit('testar', 'Domínios', `Verificação de DNS e SSL: ${up} de ${c.results.length} endereços no ar${slow ? `, ${slow} lento(s)` : ''}`)
      setRunning(false)
      if (slow) toast.warning('Verificação concluída', { description: `${slow} endereço(s) respondendo devagar (acima de ${SLOW_MS} ms).` })
      else toast.success('Tudo no ar', { description: `${up} de ${c.results.length} endereços responderam, DNS e SSL em dia.` })
    }, 1200)
  }

  const rows: Row[] = ACCESS_HOSTS.map((h) => ({ ...h, result: last?.results.find((r) => r.host === h.host) }))

  const columns: Column<Row>[] = [
    {
      id: 'host',
      header: 'Endereço',
      pinned: true,
      minWidth: 220,
      cell: (r) => (
        <div className="flex items-center gap-1">
          <div className="min-w-0">
            <Mono className="font-medium text-fg">{r.host}</Mono>
            <p className="mt-0.5 text-xs text-fg-3">{r.label}</p>
          </div>
          <CopyButton value={`https://${r.host}`} label={`Copiar https://${r.host}`} />
        </div>
      ),
    },
    { id: 'purpose', header: 'Uso', wrap: true, minWidth: 200, cell: (r) => <span className="text-[13px] text-fg-2">{r.purpose}</span> },
    {
      id: 'dns',
      header: 'Registro DNS',
      minWidth: 220,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge tone="neutral">{r.record.type}</Badge>
          <Mono>{r.record.value}</Mono>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => {
        if (!r.result) return <Badge>Sem dados</Badge>
        const lv = hostLevel(r.result)
        return (
          <Badge tone={LEVEL_TONE[lv]} dot>
            {LEVEL_LABEL[lv]}
          </Badge>
        )
      },
    },
    {
      id: 'latency',
      header: 'Resposta',
      align: 'right',
      cell: (r) =>
        r.result ? (
          <div className="text-right">
            <p className={cn('text-[13px] font-semibold tnum', r.result.latencyMs >= SLOW_MS ? 'text-warning' : 'text-fg')}>{r.result.latencyMs} ms</p>
            <p className="text-[11px] text-fg-3 tnum">HTTP {r.result.httpStatus}</p>
          </div>
        ) : (
          '—'
        ),
    },
  ]

  const sslLeft = Math.max(0, ssl.days)

  return (
    <>
      <PageHeader
        actions={
          <Button icon={RefreshCw} onClick={runCheck} loading={running}>
            Verificar agora
          </Button>
        }
      />

      <Alert tone="info" icon={UserCog} title="Somente leitura" className="mb-5">
        A compra e a ligação de um domínio novo são feitas pelo Superadmin da plataforma, e não pelo painel. Aqui você acompanha o domínio, os endereços de acesso, o DNS e o
        certificado SSL.
      </Alert>

      <section aria-label="Situação do domínio" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Domínio principal" icon={Globe} value={<span className="text-[22px]">{MAIN_DOMAIN.name}</span>} hint={`registro renova em ${regDays} dias`} />
        <KpiCard label="Certificado SSL" icon={LockKeyhole} tone={ssl.tone === 'success' ? 'success' : ssl.tone} value={ssl.label} hint={`válido até ${date(MAIN_DOMAIN.ssl.validUntil)} · ${sslLeft} dias`} />
        <KpiCard
          label="DNS e acesso"
          icon={Network}
          tone={okCount === ACCESS_HOSTS.length ? 'success' : 'danger'}
          value={`${okCount} de ${ACCESS_HOSTS.length}`}
          hint={okCount === ACCESS_HOSTS.length ? 'endereços respondendo' : 'há endereço fora do ar'}
        />
        <KpiCard label="Última verificação" icon={Activity} tone="neutral" value={last ? relative(last.at) : '—'} hint={last ? `${last.by} · ${dateTime(last.at)}` : 'nunca verificado'} />
      </section>

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={Globe}
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-mono">{MAIN_DOMAIN.name}</span>
                <Badge tone="success" dot>
                  Ativo
                </Badge>
                <Badge tone="primary">.bet.br</Badge>
              </span>
            }
            description="Domínio de operadora autorizada. Todos os endereços abaixo usam este domínio."
            actions={<CopyButton value={MAIN_DOMAIN.name} label="Copiar domínio" />}
          />
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: 'Registro', value: MAIN_DOMAIN.registrar },
                { label: 'Registrado em', value: date(MAIN_DOMAIN.registeredAt) },
                { label: 'Renovação do registro', value: `${date(MAIN_DOMAIN.expiresAt)} (automática)` },
                {
                  label: 'Servidores DNS',
                  full: true,
                  value: (
                    <span className="flex flex-wrap gap-1.5">
                      {MAIN_DOMAIN.nameservers.map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 py-0.5 pl-2 pr-0.5">
                          <Mono>{n}</Mono>
                          <CopyButton value={n} label={`Copiar ${n}`} />
                        </span>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={ShieldCheck} title="Certificado SSL" description={MAIN_DOMAIN.ssl.kind} />
          <CardBody className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <Badge tone={ssl.tone} dot size="md">
                {ssl.label}
              </Badge>
              <span className="text-xs text-fg-3 tnum">{sslLeft} de {SSL_TERM_DAYS} dias</span>
            </div>
            <Progress value={sslLeft} max={SSL_TERM_DAYS} tone={ssl.tone === 'success' ? 'success' : ssl.tone} label="Validade restante do certificado" />
            <DescriptionList
              columns={2}
              items={[
                { label: 'Emissor', value: MAIN_DOMAIN.ssl.issuer },
                { label: 'Válido desde', value: date(MAIN_DOMAIN.ssl.validFrom) },
                { label: 'Válido até', value: date(MAIN_DOMAIN.ssl.validUntil) },
                { label: 'Renovação', value: `automática a ${MAIN_DOMAIN.ssl.autoRenewDaysBefore} dias do fim` },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <DataTable
        caption="Endereços de acesso"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.host}
        columnPicker={false}
        pageSize={10}
        pageSizeOptions={[10]}
        toolbar={
          <div className="flex items-center gap-2 py-1">
            <Server size={16} className="text-fg-3" aria-hidden />
            <span className="text-sm font-semibold text-fg">Endereços de acesso</span>
            <span className="text-xs text-fg-3">resultado da última verificação</span>
          </div>
        }
        empty={{ title: 'Nenhum endereço', description: 'A plataforma ainda não ligou endereços a este domínio.' }}
      />

      <Card className="mt-5">
        <CardHeader icon={History} title="Histórico de verificações" description="A plataforma verifica sozinha a cada 6 horas. “Verificar agora” roda na hora." />
        <CardBody>
          <ol className="divide-y divide-line">
            {checks.slice(0, 8).map((c) => {
              const up = c.results.filter((r) => hostLevel(r) !== 'fora').length
              const slow = c.results.filter((r) => hostLevel(r) === 'lento').length
              const avg = Math.round(c.results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, c.results.length))
              const tone: Tone = up < c.results.length ? 'danger' : slow ? 'warning' : 'success'
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <Badge tone={tone} dot>
                    {up < c.results.length ? 'Falha' : slow ? `${slow} lento` : 'Tudo no ar'}
                  </Badge>
                  <span className="text-[13px] text-fg tnum">{dateTime(c.at)}</span>
                  <span className="text-xs text-fg-3">{relative(c.at)}</span>
                  <span className="ml-auto text-xs text-fg-3">
                    {c.by} · {up}/{c.results.length} no ar · média {avg} ms
                  </span>
                </li>
              )
            })}
          </ol>
        </CardBody>
      </Card>
    </>
  )
}
