# PLAN.md — Plataforma de campanhas "P.A PRÊMIOS"

> **Revisão 3** — 02/11/2026 · alinhada à `SPEC.md` v2.1 (abrangência nacional) e às respostas Q1–Q10.
> Status: **F0 concluída localmente**. Falta migrar para `daniel-carius/pa-premios` e ver o CI verde (seção 13).
> Decisões: [`DECISIONS.md`](./DECISIONS.md). Decisões já tomadas: SPEC 19.

---

## 1. Resumo executivo

| Item | Proposta |
|---|---|
| Arquitetura | Monólito Next.js 15 (App Router) na Vercel Pro (`gru1`) + Supabase Postgres (SP) + Upstash. |
| Ponto crítico | `NumberAllocator` (SPEC 6.1). Implementação Postgres: transação curta + `FOR UPDATE SKIP LOCKED`, somente travas de transação, **escrita e leitura da ordem do pool só por funções `SECURITY DEFINER`** (D-07). Validado através do pooler em modo transação na F0 (D-21). |
| Trabalho pesado | Dentro do banco, via pg_cron: geração do pool (uma instrução `INSERT … SELECT generate_series`) e cotas da casa (lotes de 10.000, canceláveis). |
| Escala pública | Página e dados vivos em cache de CDN de 30–60s. O banco recebe essencialmente as reservas. |
| Abrangência | **Nacional, sem bloqueio geográfico** (SPEC 19.14). Por pedido, registro de país e UF do IP, usado só em antifraude e relatórios. |
| Proteção do estoque | Turnstile invisível, ligado em production na reserva e em "Meus números" (Q4). |
| Maior risco atual | **Jurídico: venda nacional sob autorização de loteria estadual** (R-01). |

---

## 2. Stack (SPEC 2 + 19)

| Tema | Escolha | Observação |
|---|---|---|
| App | Next.js 15.5, React 19, TS 5.9 strict, pnpm 10 | D-30 |
| ORM | Prisma 6.19 | D-24 |
| Banco | Supabase Postgres (SP); app pelo **transaction pooler** com role **`pa_app`**; migrations pela conexão direta ou session pooler | D-21, D-25, D-26. Major a confirmar no painel (D-22). |
| Proteção de dados no banco | `pa_app` sem ser dono; RLS em todas as tabelas com policies só para `pa_app`; Data API fechada | D-25, D-27 |
| Jobs no banco | pg_cron (pool, cotas da casa) | D-29, D-31 |
| Jobs da app | Vercel Cron (1 min) → rotas com `CRON_SECRET` | expiração, antifraude, alertas; reconciliação na F5 |
| Storage | Supabase Storage, bucket privado, URL assinada curta + audit log | D-20 |
| Redis | Upstash (rate limit + cache); dev/CI com Redis + `serverless-redis-http` | |
| Anti-bot | Cloudflare Turnstile invisível (reserva e "Meus números") | Q4 / D-39 |
| Origem do acesso | Headers da Vercel (`x-vercel-ip-country`, `x-vercel-ip-country-region`) | D-36: não detecta VPN/datacenter |
| UI | Tailwind 4 + shadcn/ui | |
| Validação | Zod 4 em todas as bordas | |
| Auth admin | Auth.js Credentials + argon2id + TOTP; sessão 8h; reconfirmação de senha | |
| E-mail | Resend (adapter) / Mailpit no dev | |
| Testes | Vitest (unit + integração com Postgres real atrás do pgbouncer em modo transação), Playwright 390x844 | |
| Erros | Sentry (F5) | |

---

## 3. Arquitetura

```
                ┌──────────── CDN (Vercel Edge) ─────────────┐
 Instagram /    │ /c/[slug] ISR + revalidateTag              │
 WhatsApp  ───▶ │ /api/public/*/live     s-maxage=30, SWR    │
 (mobile)       │ /api/public/*/ranking  s-maxage=60, SWR    │
                └──────────────┬─────────────────────────────┘
                               │ dinâmico
                ┌──────────────▼─────────────────────────────┐
                │ Next.js (Route Handlers + Server Actions)  │
                │  checkout: CPF → dados → bump → Turnstile → reserva
                │  admin (RBAC módulo×ação, TOTP, reauth)    │
                │  webhooks PSP · cron (CRON_SECRET)         │
                └──┬─────────────┬──────────────┬────────────┘
     pooler 6543   │             │              │
     role pa_app   │             │              │
          ┌────────▼────────┐ ┌──▼─────┐ ┌──────▼──────────┐
          │ Supabase PG (SP)│ │Upstash │ │ PaymentProvider │
          │ funções SECURITY│ │ RL +   │ │ Mock (até F4)   │
          │ DEFINER do motor│ │ cache  │ │ real na F5      │
          │ + pg_cron jobs  │ └────────┘ └─────────────────┘
          └────────┬────────┘
          Supabase Storage (privado) · Resend · Turnstile · Sentry
```

### 3.1 Código
```
app/                      rotas (público, admin, api)
src/domain/               regras puras, sem I/O (ESLint bloqueia imports de infra)
src/allocator/            (F1) interface NumberAllocator + implementação Postgres (chama funções SQL)
src/services/             (F1+) casos de uso transacionais
src/infra/                db, redis, settings, storage, email, payments, turnstile, ip-origin
src/env/                  schema Zod do ambiente
src/ui/                   componentes (shadcn/ui)
prisma/                   schema, migrations (SQL manual incluso), seed
tests/{unit,integration,e2e}
docker/                   imagem Postgres com pg_cron, config do pgbouncer
docs/supabase-setup.md    checklist de contas
```

### 3.2 Ambientes
- `APP_ENV` validado por Zod no boot. `staging`: faixa "AMBIENTE DE HOMOLOGAÇÃO", `noindex`.
- `production`: `MockProvider` e `simulate-payment` impossíveis (checagem no código). Turnstile ligado por padrão (`effectiveTurnstileEnabled`, já na F0).

---

## 4. Modelo de dados (Prisma)

Convenções: tabelas e colunas em snake_case; dinheiro em centavos (`Int`), somatórios em `BigInt`; `publicId` aleatório nas URLs; UTC no banco, "dia" em America/Fortaleza. **Toda tabela nova recebe RLS + policy para `pa_app` na mesma migration** (o teste `rls.test.ts` falha se faltar).

```prisma
// ── Enums ───────────────────────────────────────────────
enum AdminRole          { OWNER OPERATOR FINANCE SUPPORT }
enum CampaignStatus     { DRAFT GENERATING_NUMBERS PUBLISHED SALES_PAUSED SALES_CLOSED DRAWN FINISHED CANCELLED }
enum DrawRule           { DEFAULT_6 /* DEFAULT_7: backlog */ }
enum UnsoldRule         { NEXT_PAID_CIRCULAR }
enum AuthorizationScope { NATIONAL STATE /* STATE: backlog */ }                 // F0 ✔
enum TicketStatus       { AVAILABLE RESERVED PAID HOUSE }
enum OrderStatus        { PENDING PAID EXPIRED CANCELLED REFUND_PENDING REFUNDED }
enum RefundKind         { WITHDRAWAL CAMPAIGN_CANCELLED DUPLICATE LEGAL_ORDER LATE_PAYMENT }   // Q1
enum PaymentStatus      { PENDING PAID EXPIRED REFUNDED FAILED }
enum JobStatus          { PENDING RUNNING CANCEL_REQUESTED CANCELLED DONE FAILED }
enum HouseDirection     { BLOCK RELEASE }
enum WinnerType         { MAIN INSTANT_PRIZE RANKING }
enum WinnerStage        { NEW CONTACTED DOCS_RECEIVED DOCS_VALIDATED PRIZE_CHOSEN TAX_HANDLED DELIVERED PROOF_ATTACHED COMPLETED REVOKED }
enum PrizeChoice        { GOODS CASH }
enum DocumentKind       { ID_DOCUMENT CPF_DOCUMENT ADDRESS_PROOF DELIVERY_PROOF TAX_GUIDE AUTHORIZATION REFUND_PROOF }
enum FraudKind          { SHARED_PHONE SHARED_EMAIL SHARED_IP SHARED_DEVICE MANY_EXPIRED FOREIGN_IP PURCHASE_SPIKE }
enum ReviewStatus       { OPEN RELEASED CPF_BLOCKED ORDER_CANCELLED }
enum AlertKind          { PAYMENT_MISMATCH WEBHOOK_FAILING INSTANT_PRIZE_FOUND SALES_STALLED CLAIM_DEADLINE JOB_FAILED REFUND_PENDING }
enum AlertStatus        { OPEN ACKNOWLEDGED RESOLVED }
enum ContentKey         { TERMS PRIVACY FAQ }
enum ActorType          { ADMIN SYSTEM CUSTOMER }                                // F0 ✔

// ── Configuração (F0 ✔) ─────────────────────────────────
model Settings {               // linha única, CHECK (id = 1), RLS
  // marca, suporte, timezone, dados legais, show_authorization_badge, banner antigolpe,
  // authorization_scope (NATIONAL), turnstile_enabled (null = default do ambiente)   ← já existem
  // F2 acrescenta:
  stalledSalesMinutes Int?; peakHours Json?; alertEmails String[]; alertWhatsapps String[]   // WhatsApp: F5
}

model Modality  { id Int @id; name String; organ String; allowsCashPrize Boolean @default(false); active Boolean }
model AdminUser { id String @id; email String @unique; name String; passwordHash String
                  totpSecretEnc Bytes?; totpEnabledAt DateTime?; role AdminRole; active Boolean
                  sessionVersion Int @default(0); failedLogins Int; lockedUntil DateTime?; lastLoginAt DateTime? }

// ── Participantes ───────────────────────────────────────
model Customer {
  id BigInt @id; cpfHash String @unique; cpfEnc Bytes; cryptoKeyVersion Int
  fullName String; email String; phoneDdi String @default("55"); phone String; birthDate DateTime @db.Date
  marketingConsent Boolean @default(false); marketingConsentAt DateTime?; marketingRevokedAt DateTime?
  blockedAt DateTime?; blockedReason String?; anonymizedAt DateTime?
  @@index([email]) @@index([phone])
}

// ── Campanha ────────────────────────────────────────────
model Campaign {
  id Int @id; slug String @unique; title String; description String; status CampaignStatus @default(DRAFT); featured Boolean
  modalityId Int?
  ticketPriceCents Int; totalTickets Int; minOrderValueCents Int        // travados após a 1ª reserva (trigger)
  maxPerOrder Int; maxPerCpf Int; reservationMinutes Int @default(15)
  quantityPresets Int[] @default([50, 100, 200, 500]); popularPreset Int? @default(100)
  drawDate DateTime?; lotteryContest Int?; drawRule DrawRule; unsoldRule UnsoldRule
  cashOptionEnabled Boolean @default(false); cashValueCents Int?         // trigger: só se modality.allowsCashPrize
  whatsappGroupUrl String?; instantPrizesEnabled Boolean @default(false)
  showRanking Boolean @default(true); rankingPrizeEnabled Boolean @default(false); rankingPrizeText String?
  progressVisible Boolean; progressShowFromPct Int; progressRounding Int; progressShowPct Boolean; progressShowRemaining Boolean
  milestoneMessages Json
  transparencyNoteEnabled Boolean @default(true)
  transparencyNoteText String @default("Inclui números reservados pela organização, que não concorrem a prêmios.")
  salesPausedReason String?; cancelReason String?
  currentRegulationId String?; firstReservationAt DateTime?
  publishedAt DateTime?; salesClosedAt DateTime?; drawnAt DateTime?; finishedAt DateTime?; cancelledAt DateTime?
}

model CampaignAuthorization {    // cadastro interno, obrigatório para publicar em production
  campaignId Int @id; promoterLegalName String; promoterCnpj String; modalityId Int; organ String
  number String; validFrom DateTime @db.Date; validUntil DateTime @db.Date; documentPath String?
}

model CampaignMedia { id String @id; campaignId Int; type String; url String; alt String?; position Int }
model OrderBump     { id String @id; campaignId Int; position Int; extraTickets Int; priceCents Int; imageUrl String?; active Boolean
                      @@unique([campaignId, position]) }      // trigger: priceCents < extraTickets × preço
model InstantPrize  { id String @id; campaignId Int; number Int; description String; frozenAt DateTime?
                      winnerCaseId String?; revokedAt DateTime?; revokeReason String?
                      @@unique([campaignId, number]) }
model RegulationVersion { id String @id; campaignId Int; version Int; kind String; errataReason String?
                          markdown String; sha256 String; pdfPath String?; pdfSha256 String; publishedAt DateTime?
                          @@unique([campaignId, version]) }
model MessageTemplate { id String @id; campaignId Int?; name String; body String; updatedById String }
model ContentPage     { id String @id; key ContentKey; version Int; markdown String; publishedAt DateTime? }

// ── Motor de números ────────────────────────────────────
model Ticket {
  campaignId Int; number Int; shuffleRank Int; status TicketStatus @default(AVAILABLE)
  orderId BigInt?; reservedUntil DateTime?; isInstantPrize Boolean @default(false)
  @@id([campaignId, number])
  // SQL manual:
  //  - índice (campaign_id, status, shuffle_rank) [SPEC 6.2]; índice parcial PAID (apuração)
  //  - CHECK (NOT (is_instant_prize AND status = 'HOUSE'))
  //  - D-07: pa_app recebe SELECT apenas em (campaign_id, number, status, order_id, reserved_until,
  //    is_instant_prize). Sem SELECT em shuffle_rank e sem INSERT/UPDATE/DELETE: toda escrita passa
  //    pelas funções SECURITY DEFINER do motor.
}
model CampaignCounter   { campaignId Int; shard Int; paid Int; reserved Int; house Int; paidRevenueCents BigInt; @@id([campaignId, shard]) }
model PoolGenerationJob { id String @id; campaignId Int; status JobStatus; total Int; error String?; orderingSha256 String?
                          requestedById String; startedAt DateTime?; finishedAt DateTime? }
model HouseJob { id String @id; campaignId Int; direction HouseDirection; mode String; targetPct Int?
                 requested Int; processed Int @default(0); batchSize Int @default(10000)
                 status JobStatus; error String?; createdById String; cancelledById String?; finishedAt DateTime? }

// ── Pedidos, pagamento, aceite ──────────────────────────
model Order {
  id BigInt @id; publicId String @unique; code String @unique; campaignId Int; customerId BigInt
  status OrderStatus; baseQuantity Int; bumpQuantity Int; quantity Int; amountCents Int
  expiresAt DateTime; paidAt DateTime?; latePayment Boolean
  // Origem do acesso (SPEC 13A): só registro
  ip String; ipCountry String? @db.Char(2); ipUf String? @db.Char(2); userAgent String; deviceId String?
  // Reembolso (Q1)
  refundKind RefundKind?; refundReason String?; refundRequestedById String?; refundApprovedById String?
  refundedAt DateTime?; refundEndToEndId String?        // devolução PIX vinculada ao e2eId do pagamento
  createdAt DateTime
  @@index([campaignId, status, createdAt]) @@index([customerId, campaignId]) @@index([status, expiresAt]) @@index([campaignId, ipUf])
  // SQL manual: UNIQUE (campaign_id, customer_id) WHERE status = 'PENDING'
}
model OrderBumpSelection { orderId BigInt; bumpId String; extraTickets Int; priceCents Int; @@id([orderId, bumpId]) }
model Acceptance { id String @id; orderId BigInt @unique; regulationVersionId String; regulationSha256 String
                   termsVersion Int; ageDeclared Boolean; marketingConsent Boolean; ip String; userAgent String; acceptedAt DateTime }
model Payment { id String @id; orderId BigInt; provider String; providerChargeId String; txid String @unique
                amountCents Int; status PaymentStatus; pixCopyPaste String; expiresAt DateTime
                paidAt DateTime?; paidAmountCents Int?; endToEndId String?; feeCents Int? }
model WebhookEvent { id String @id; provider String; eventId String; payloadSha256 String; signatureValid Boolean
                     processedAt DateTime?; error String?; @@unique([provider, eventId]) }

// ── Ranking ─────────────────────────────────────────────
model ParticipantStat      { campaignId Int; customerId BigInt; paidTickets Int; reachedAt DateTime; @@id([campaignId, customerId]) }
model ParticipantDailyStat { campaignId Int; day DateTime @db.Date; customerId BigInt; paidTickets Int; reachedAt DateTime
                             @@id([campaignId, day, customerId]) }

// ── Apuração e ganhadores ───────────────────────────────
model Draw { id String @id; campaignId Int @unique; contestNumber Int; contestDate DateTime @db.Date; prizes String[]
             enteredById String; confirmedById String /* ≠ enteredById em production */; drawnNumber Int; winningNumber Int
             steps Json; officialResultUrl String }
model WinnerCase { id String @id; campaignId Int; type WinnerType; customerId BigInt; orderId BigInt; number Int?; prize String
                   stage WinnerStage @default(NEW); choice PrizeChoice?; city String?; uf String? @db.Char(2)
                   suggestedUf String? @db.Char(2)  // = order.ipUf (indicativa)
                   claimDeadline DateTime; displayName String; deliveryVideoUrl String?; publishedAt DateTime?
                   revokedAt DateTime?; revokeReason String? }
model WinnerDocument { id String @id; caseId String; kind DocumentKind; storagePath String; sha256 String; uploadedById String; createdAt DateTime }
model TaxRecord      { caseId String @id; baseCents BigInt; rateBasisPoints Int; amountCents BigInt; paidAt DateTime?; guideDocumentId String? }

// ── Antifraude e alertas ────────────────────────────────
model FraudSignal { id String @id; customerId BigInt; campaignId Int?; orderId BigInt?; kind FraudKind; details Json
                    status ReviewStatus @default(OPEN); reviewedById String?; reviewedAt DateTime?; createdAt DateTime }
model Alert { id String @id; kind AlertKind; campaignId Int?; message String; payload Json; status AlertStatus @default(OPEN)
              notifiedAt DateTime?; acknowledgedById String?; createdAt DateTime }

// ── Auditoria (F0 ✔) ────────────────────────────────────
model AuditLog { id BigInt @id; actorType ActorType; actorId String?; action String; entityType String; entityId String
                 campaignId Int?; before Json?; after Json?; reason String?; ip String?; createdAt DateTime }
```

### 4.1 Guardas no banco (SQL manual)
| Regra | Mecanismo | Fase |
|---|---|---|
| Audit log append-only | `pa_app` só SELECT/INSERT + trigger em UPDATE/DELETE/TRUNCATE para qualquer role | **F0 ✔** |
| App não burla travas por SQL | `pa_app` não é dono: não desabilita trigger nem altera schema | **F0 ✔** |
| Data API fechada | revoke de `anon`/`authenticated` + remover `public` dos schemas expostos | **F0 ✔** |
| RLS em todas as tabelas | `ENABLE ROW LEVEL SECURITY` + policies `TO pa_app`; teste falha se alguma tabela ficar sem RLS | **F0 ✔** |
| Ordem do pool invisível | `pa_app` sem SELECT em `shuffle_rank` e sem escrita direta em `tickets`; funções `SECURITY DEFINER` (`search_path` fixo) devolvem só os números | F1 |
| 1 reserva pendente por CPF/campanha | índice único parcial | F1 |
| Cota premiada ≠ casa | `CHECK` | F1 |
| Travas pós-venda | trigger quando `first_reservation_at IS NOT NULL` | F1 (trigger) / F2 (UI) |
| Opção em dinheiro só com `allows_cash_prize` | trigger | F2 |
| Order bump com desconto real | trigger | F3 |
| Apuração, cotas premiadas congeladas e regulamento publicado imutáveis | triggers | F2–F4 |

---

## 5. Motor de números

### 5.1 Interface (SPEC 6.1)
```ts
interface NumberAllocator {
  allocate(tx, { campaignId, orderId, quantity, reservedUntil }): Promise<number[]>;
  release(tx, { campaignId, orderId }): Promise<number>;
  confirm(tx, { campaignId, orderId }): Promise<number[]>;
  blockHouse({ campaignId, quantity, actorId }): Promise<{ jobId: string }>;
  releaseHouse({ campaignId, quantity, actorId }): Promise<{ jobId: string }>;
  stats(campaignId): Promise<{ paid; reserved; house; available; total }>;
}
```
`PostgresNumberAllocator` só chama funções SQL (`pa_allocate_tickets`, `pa_release_tickets`, `pa_confirm_tickets`, `pa_request_house_job`), executadas na transação do chamador. Nenhum outro módulo acessa `tickets` diretamente.

### 5.2 Geração do pool (SPEC 6.3)
1. Publicar: valida pendências (12.3), cria `PoolGenerationJob(PENDING)`, campanha → `GENERATING_NUMBERS`, responde na hora.
2. pg_cron (1 min) chama `pa_process_pool_jobs()` (dono): pega 1 job com `FOR UPDATE SKIP LOCKED`; `INSERT … SELECT generate_series … ON CONFLICT DO NOTHING` com `random()`; cria os 16 shards; grava `orderingSha256` (D-07); campanha → `PUBLISHED`. Em erro: job `FAILED`, campanha → `DRAFT`, alerta.
3. Atômica (tudo ou nada) e idempotente.

### 5.3 Reserva
```
fora da tx: Zod, honeypot, Turnstile (production), rate limit (IP + CPF), CPF válido, 18+, CPF não bloqueado,
            país/UF do IP pelos headers da Vercel (só registro)
BEGIN
  SET LOCAL statement_timeout = '5s'
  pg_advisory_xact_lock(campaign_id, customer_id)
  SELECT status FROM campaigns WHERE id=$c FOR SHARE         -- exige PUBLISHED
  limites (base + bump): qty ≤ max_per_order; pagos + pendentes + qty ≤ max_per_cpf; valor ≥ mínimo
  INSERT order (PENDING, ip, ip_country, ip_uf)
  SELECT pa_allocate_tickets($c, $order, $qty, $until)       -- SECURITY DEFINER; devolve os números
  se < qty → ROLLBACK ("restam N cotas")
  1ª reserva → first_reservation_at = now()
COMMIT
fora da tx: createPixCharge(); se falhar → release + CANCELLED
depois: IP com país ≠ BR → FraudSignal(FOREIGN_IP); a compra NÃO é bloqueada (SPEC 13A)
```

### 5.4 Pausar vendas
`PUBLISHED → SALES_PAUSED` com `FOR UPDATE`, motivo, reauth e audit log. A reserva lê o status no banco: o bloqueio é imediato. Os pagamentos de reservas já criadas seguem.

### 5.5 Cotas da casa
Prévia → reauth → `HouseJob`. pg_cron a cada 2s: 1 lote de 10.000 por execução e por transação (`SKIP LOCKED`, `NOT is_instant_prize`), checando cancelamento antes de cada lote. Barra de progresso no admin. Quantidade absoluta (D-05).

### 5.6 Reembolso (Q1, D-37)
| Regra | Implementação |
|---|---|
| Destino | Sempre devolução PIX vinculada ao `endToEndId` do pagamento (mesma conta pagadora). A tela não tem campo de conta de destino. |
| Arrependimento (`WITHDRAWAL`) | Permitido se `now − paidAt ≤ 7 dias` **e** `status = PUBLISHED/SALES_PAUSED` (antes do encerramento) **e** nenhuma cota premiada contemplada no pedido. |
| Após o encerramento | Só `CAMPAIGN_CANCELLED`, `DUPLICATE` ou `LEGAL_ORDER`. |
| Cota premiada contemplada + reembolso obrigatório | Revoga antes o prêmio da cota premiada (`InstantPrize.revokedAt`, `WinnerCase → REVOKED`) com audit log; depois reembolsa. Destino do número: D-43. |
| Números | Voltam a `AVAILABLE`. Antes do encerramento podem ser revendidos; depois ficam não vendidos (fora da apuração). |
| Ranking | Recalcula `ParticipantStat` e `ParticipantDailyStat` do participante a partir dos pedidos pagos restantes. |
| Fluxo | Solicitação (motivo + tipo) → aprovação do financeiro → execução. Manual com alerta até a F4; automático pelo `refund` do provider na F5. |
| Campanha `CANCELLED` | Cria `REFUND_PENDING` (tipo `CAMPAIGN_CANCELLED`) para todos os pedidos pagos + alerta. |

### 5.7 Order bump (Q2, D-38)
O servidor calcula o espaço restante: `min(max_per_order − qty, max_per_cpf − pagos − pendentes − qty)`. Bump com `extraTickets` acima disso **não é exibido**. Na reserva, os limites são verificados de novo com base + bump.

---

## 6. Origem do acesso (SPEC 13A)
- Por pedido: `ip`, `ipCountry`, `ipUf` (headers da Vercel) e timestamp.
- Uso: antifraude (`FOREIGN_IP`) e relatório de vendas por UF. **Nenhum bloqueio por localização.**
- UF sugerida do ganhador (12.6) = `order.ipUf`, marcada como indicativa (IP de internet móvel pode apontar outra UF).
- Limitação (D-36): os headers não detectam VPN/datacenter. Fica prevista uma interface `IpIntelligenceProvider` para um provedor externo, se um dia o modo STATE ou o antifraude exigirem.
- Modo STATE (GPS + polígono da UF + CEP): backlog. As respostas Q6/Q7 do modo STATE ficam registradas em D-40.

---

## 7. Apuração (SPEC 11)
- `domain/draw.ts`: `DEFAULT_6 = últimos3(1º) ‖ últimos3(2º)` → 68003, 33062 → `003062`.
- Aproximação circular para o próximo `PAID`; casa, reservada e disponível são puladas por construção.
- **Dupla digitação (Q3, D-15):** dois usuários **distintos** com permissão de apuração (owner, operador ou financeiro), em qualquer ordem. Em production o banco rejeita `confirmedById = enteredById`. Dev/staging: o mesmo usuário é permitido.
- `Draw` imutável, `WinnerCase(NEW)`, campanha `DRAWN`, audit log. DEFAULT_7: backlog (`it.todo` com `0030627`).

---

## 8. Admin (SPEC 12)

### 8.1 Acesso
Matriz módulo × ação (ver, editar, exportar, aprovar) por papel, versionada em código (D-34). Sessão de 8h, `sessionVersion`, reauth de 5 min nas ações sensíveis.

| Módulo | owner | operador | financeiro | suporte |
|---|---|---|---|---|
| Dashboard | ver | ver | ver | ver |
| Campanhas (dados, regulamento, ofertas, premiadas, ranking, progresso) | ver/editar | ver/editar | ver | ver |
| Autorização (cadastro interno e documento) | ver/editar | ver/editar | ver | — |
| Publicar / pausar / encerrar / cancelar campanha | aprovar | aprovar | — | — |
| Cotas da casa | ver/editar | ver/editar | ver | — |
| **Apuração (digitar ou confirmar; 2 usuários distintos)** | aprovar | aprovar | aprovar | — |
| Pedidos | ver/editar | ver | ver/aprovar reembolso | ver + reenviar e-mail + cancelar pendente |
| Solicitar reembolso | sim | sim | sim | sim |
| Participante 360 / revelar / bloquear / exportar titular | tudo | ver/revelar | ver | ver/revelar |
| Ganhadores e entrega | tudo | ver/editar | editar IR e pagamento | ver/editar contato |
| Financeiro / conciliação / fechamento | tudo | — | tudo | — |
| Relatórios e exportações | exportar | exportar | exportar | — |
| Antifraude | tudo | ver/editar | ver | ver |
| Alertas | tudo | ver/reconhecer | ver/reconhecer | ver |
| Templates de mensagens | editar | editar | — | ver |
| Configurações (incl. Turnstile), modalidades, usuários | editar | ver | — | — |
| Audit log | ver/exportar | ver | ver | — |

### 8.2 Módulos
| Seção | Pontos de implementação |
|---|---|
| 12.2 Dashboard | Agregados dos shards; vendas por hora hoje × ontem; top compradores; **vendas por UF** (`orders.ip_uf`); alertas ativos. |
| 12.3 Campanhas | `publicationBlockers()` pura: regex `\[PREENCHER:` em regulamento, termos e política; autorização completa e vigente; `authorization_scope` definido. Cancelar campanha → fluxo 5.6. |
| 12.4 Pedidos | Busca por CPF (hash), nome, telefone, e-mail, código, txid, número; detalhe com origem do acesso; reembolso em 2 passos. |
| 12.5 Participante | Mascarado; revelar com reauth + audit log; exportação do titular; anonimização respeitando a retenção. |
| 12.6 Ganhadores | Etapas em sequência; documentos no bucket privado; cidade/UF obrigatórias em "documentos validados" (sugestão = UF do IP); IR só registrado (Q9); prazo de reclamação + alerta; publicação após `DELIVERED`; `REVOKED` para prêmio revogado. |
| 12.7 Financeiro | Conciliação; reembolsos; fechamento; CSV/XLSX. |
| 12.8 Relatórios | Por campanha, incluindo **origem por UF**; modelo de prestação de contas; tudo no audit log. |
| 12.9 Antifraude | Sinais: mesmo telefone/e-mail/IP/dispositivo (cookie first-party, D-33) em vários CPFs, expirações em série, **IP estrangeiro**, pico por CPF. Fila: liberar / bloquear CPF / cancelar pendente. |
| 12.10 Alertas | Pagamento divergente, webhook falhando, cota premiada, venda parada, prazo de reclamação, erro de job, reembolso pendente. E-mail na F2, WhatsApp Cloud API na F5 (Q8). |
| 12.11 Templates | Variáveis com dados reais; botão copiar. |
| 12.12 Configurações | Globais (sem campos territoriais na UI), modalidades, termos, política, FAQ, usuários e papéis, toggle do Turnstile. |
| 12.13 Audit log | Filtros e exportação. |

---

## 9. Rotas

### 9.1 Públicas
`/` (ISR 60s) · `/c/[slug]` (ISR + `revalidateTag`) · `/c/[slug]/resultado`, `/resultados` (ISR) · `/pedido/[publicId]` (dinâmica, `noindex`) · `/meus-numeros` · `/termos`, `/privacidade`, `/faq` (ISR).

### 9.2 API
| Rota | Cache / proteção |
|---|---|
| `GET /api/health` | **F0 ✔** `no-store` |
| `GET /api/public/campaigns/[slug]/{live,ranking,instant-prizes}` | `s-maxage` 30/60s |
| `POST /api/checkout/identify` (passo 1) | RL IP + CPF, honeypot |
| `POST /api/checkout/offers` (passo 3) | devolve só os bumps que cabem nos limites |
| `POST /api/checkout/reserve` (passo 4) | **Turnstile** (production), RL, honeypot, Origin |
| `GET /api/orders/[publicId]/status` | `no-store`, verificação lazy de expiração |
| `GET /api/orders/[publicId]/numbers.csv` | só `PAID` |
| `POST /api/orders/[publicId]/simulate-payment` | inexistente em production |
| `POST /api/meus-numeros/lookup` + `GET …/orders` | **Turnstile** (production), RL 5/15min IP e CPF, cookie assinado de 15 min |
| `POST /api/webhooks/payments/[provider]` | F5 |
| `POST /api/cron/{expire-reservations, reconcile, fraud-scan, alerts}` | `CRON_SECRET` |

### 9.3 Admin
`/admin/{login,2fa,dashboard,campanhas,campanhas/[id]/{dados,autorizacao,regulamento,cotas-casa,ofertas,premiadas,ranking,progresso,apuracao},pedidos,participantes/[id],ganhadores,financeiro,relatorios,antifraude,alertas,templates,configuracoes,usuarios,auditoria}`

---

## 10. Segurança e LGPD
| Requisito | Como |
|---|---|
| CPF | AES-256-GCM com chave versionada + `cpfHash` HMAC |
| CPF digitado | `identify` devolve só `{known, "J***** V.", "(99) *****-3568", missing}`; tempo constante |
| Cadastro existente | só completa campos vazios (D-12) |
| Ordem do pool | invisível para a aplicação e para usuários humanos; acesso emergencial só pelo dono do banco, com registro (D-07) |
| Reservas em massa | Turnstile + RL por IP e CPF + 1 pendente por CPF |
| Logs | pino com redaction; Sentry sem body e sem cookies |
| Headers | HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, `Permissions-Policy` com câmera, microfone e geolocalização desligados — **F0 ✔**; CSP com nonce na F1 (incluir `challenges.cloudflare.com`) |
| Banco | `pa_app` restrito, RLS, Data API fechada — **F0 ✔** |
| Documentos | bucket privado; URL assinada de 60s; emissão no audit log |
| Origem do acesso | IP, país e UF por pedido (finalidade: prevenção a fraude; informar na Política de Privacidade) |

---

## 11. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | **Venda nacional sob autorização de loteria estadual.** Pelo que conheço, a Lei 14.790/2023 incluiu na Lei 13.756/2018 a regra de que loterias estaduais só comercializem dentro do território do ente, e o tema foi judicializado no STF. Não consigo confirmar o estado atual daqui. | Se a autorização for estadual, vender para outros estados pode invalidar a operação e gerar sanção, mesmo com regulamento e selo corretos. | Parecer jurídico por escrito antes de publicar em production. O campo `authorization_scope` e o desenho do modo STATE (D-40) permitem reativar a restrição territorial sem refazer o checkout. |
| R-02 | Edital impor numeração externa ou certificação | Retrabalho no motor | `NumberAllocator` isolado. |
| R-03 | Turnstile com falso positivo ou fora do ar no pico | Comprador legítimo barrado ou vendas paradas | Modo invisível; decisão de comportamento em falha (D-41); métrica de desafios × conclusões no dashboard. |
| R-04 | Arrependimento limitado ao período antes do encerramento | Reclamação com base no CDC (art. 49 prevê 7 dias para compra fora do estabelecimento) | Regra escrita no regulamento (item 8) e validada pelo jurídico. |
| R-05 | Data API do Supabase exposta por engano | Vazamento de PII | Revoke + RLS + teste (**F0 ✔**) + painel. |
| R-06 | Membro do projeto Supabase ler `tickets` pelo Table Editor | Ordem do pool conhecida | Restringir membros do projeto; acesso emergencial com registro (pgaudit ou procedimento formal, D-07). |
| R-07 | Conexões no pooler (Fluid Compute) | Esgotar conexões no pico | `connection_limit=5` + conferir o limite do plano no k6 (D-26). |
| R-08 | Versão do Postgres no Supabase ≠ 16 | Diferença dev × prod | `PG_MAJOR` parametrizado (D-22). |
| R-09 | Contenção nos contadores | Timeouts | 16 shards. |
| R-10 | Enumeração de CPF no passo 1 | Vazamento parcial | RL, honeypot, tempo constante; Turnstile pode ser estendido ao passo 1 se houver abuso. |
| R-11 | "Meus números" com CPF + nascimento | Exposição de números | Sem PII na tela; RL; Turnstile; OTP no backlog. |
| R-12 | PSP congelar a conta | Receita retida | Provider real só com aceite escrito. |
| R-13 | Repositório definitivo ainda não existe | CI do GitHub não validado | Branch `pa-premios-export` pronta (D-23). |

---

## 12. Perguntas

### 12.1 Respondidas
| # | Resposta | Registro |
|---|---|---|
| Q1 | (a) sim, (b) sim, (c) manual com alerta até a F4, automático na F5; regras de destino, arrependimento, cota premiada, ranking e cancelamento | D-37, seção 5.6 |
| Q2 | Bump conta nos dois limites; não é exibido se ultrapassar | D-38, seção 5.7 |
| Q3 | Dois usuários distintos com permissão de apuração (owner, operador ou financeiro) | D-15, seção 7 |
| Q4 | Turnstile invisível ligado em production na reserva e em "Meus números"; toggle no admin; desligado em dev/staging | D-39 |
| Q5 | Headers da Vercel para país e UF, só para registro | D-36 |
| Q6, Q7 | **Obsoletas**: resolvidas pela abrangência nacional (SPEC 19.14) | D-40 |
| Q8 | E-mail na F2; WhatsApp Cloud API na F5 | D-45 |
| Q9 | IR só registrado na F2 | D-46 |
| Q10 | Cookie first-party | D-33 |

### 12.2 Novas (não bloqueiam a F1, salvo indicação)
| # | Pergunta | Recomendação | Bloqueia |
|---|---|---|---|
| N1 | O jurídico confirma por escrito que a autorização permite venda em todo o território nacional (R-01)? | Exigir o parecer antes da 1ª publicação em production | publicação em production |
| N2 | Se o Turnstile estiver fora do ar, a reserva segue (fail-open, com rate limit mais rígido e alerta) ou para (fail-closed)? | Fail-open com RL reduzido e alerta | F1 |
| N3 | Cota premiada revogada por reembolso obrigatório: o número volta ao estoque e o prêmio volta a "Disponível", ou o prêmio fica cancelado? | Antes do encerramento: volta a "Disponível"; depois: prêmio cancelado e registrado | F3 |

---

## 13. Fases (SPEC 17)

| Fase | Entregáveis | Aceite | Status |
|---|---|---|---|
| **F0 — Setup** | Next 15 + TS strict + pnpm; Docker Compose (Postgres + pg_cron, pgbouncer em modo transação, Redis + REST, Mailpit); Prisma + migrations (settings com `authorization_scope` e `turnstile_enabled`, audit log append-only, role `pa_app`, pg_cron, lockdown da Data API, RLS); `APP_ENV`; faixa de staging; rodapé legal; `/api/health`; CI; CLAUDE.md; checklist do Supabase | `pnpm dev` sobe; CI verde | **Concluída localmente.** Falta: migrar para o repositório definitivo e ver o CI verde. |
| F1 — Núcleo de venda | página da campanha, seletor, checkout (CPF, dados, bump, Turnstile, reserva), `NumberAllocator` com funções `SECURITY DEFINER`, pool via pg_cron, PIX mock, expiração, confirmação, e-mail, grupo do WhatsApp, suporte, banner antigolpe, Meus números, registro da origem do acesso | E2E mobile; testes da seção 15 (concorrência, pool, limites, 18+, CPF, origem do acesso); `pa_app` recebe permission denied em `SELECT shuffle_rank`; **D-21 repetido contra o pooler real do Supabase em staging** | aguardando |
| F2 — Admin | seção 12 completa | SPEC 17 | aguardando |
| F3 — Conversão | progresso + casa + nota, ranking, order bump, compartilhar, templates | testes da seção 15 | aguardando |
| F4 — Apuração | DEFAULT_6, aproximação, resultado, ganhadores | testes da seção 15 | aguardando |
| F5 — Produção | PIX real, webhooks, reconciliação, reembolso automático, WhatsApp Cloud API, rate limit, Sentry, backups, k6 (incluindo limite de conexões do plano Supabase) | metas da seção 14 | aguardando |

Diretrizes de UI: alvos de toque ≥ 44px, texto ≥ 16px, contraste AA, `prefers-reduced-motion`, ícones Lucide, barra fixa com `safe-area-inset-bottom`, botão de suporte acima da barra sem cobrir conteúdo, cores e logo de `settings`.

---

## 14. Oportunidades (não implementar sem aprovação)
1. Funil por etapa do checkout (CPF → dados → bump → PIX → pago) no dashboard.
2. Lembrete de reserva expirada por e-mail transacional (validar a base legal).
3. Página pública de auditoria por campanha (hash do regulamento, `orderingSha256`, contagem final por status).
4. UTM e origem por pedido (qual story ou grupo gera receita).
