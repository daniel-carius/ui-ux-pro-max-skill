# PLAN.md — Plataforma de campanhas "P.A PRÊMIOS"

> **Revisão 2** — 02/11/2026 · alinhada à `SPEC.md` v2.0 (consolidada).
> Status: **F0 concluída** (ver seção 13). F1 aguarda aprovação deste plano e das perguntas da seção 12.
> Decisões sem regra na spec: [`DECISIONS.md`](./DECISIONS.md). Decisões já tomadas: SPEC 19.

---

## 1. Resumo executivo

| Item | Proposta |
|---|---|
| Arquitetura | Monólito Next.js 15 (App Router) na Vercel Pro (`gru1`) + Supabase Postgres (SP) + Upstash. |
| Ponto crítico | `NumberAllocator` (SPEC 6.1). Implementação padrão em Postgres: transação curta + `FOR UPDATE SKIP LOCKED`, somente travas presas à transação. **Validado através do pooler em modo transação na F0** (D-21). |
| Trabalho pesado | Dentro do banco, via pg_cron: geração do pool (uma instrução `INSERT … SELECT generate_series`) e cotas da casa (lotes de 10.000, canceláveis). Nada depende de timeout de função. |
| Escala pública | Página e dados vivos em cache de CDN de 30–60s. O banco recebe essencialmente as reservas. |
| Compliance novo (v2) | Territorialidade (13A): GPS + polígono IBGE no servidor + IP como sinal secundário, revalidado no passo 4, com registro por pedido. |
| Maior risco novo | **Falso bloqueio por IP de operadora móvel** (R-02). Pode derrubar conversão no MA sem nenhum ganho de compliance. Ver Q6. |

---

## 2. Stack (final, SPEC 2 + 19)

| Tema | Escolha | Observação |
|---|---|---|
| App | Next.js 15.5, React 19, TS 5.9 strict, pnpm 10 | Next 16 e TS 7 existem, mas a spec fixa Next 15; TS 7 não é suportado pelo Next 15. |
| ORM | **Prisma 6.19** | Prisma 7 troca o engine e exige driver adapters; 6.x é estável com `pgbouncer=true` (D-24). |
| Banco | Supabase Postgres, SP; app pelo **transaction pooler** com role **`pa_app`**; migrations pela conexão direta/session pooler | D-21, D-25, D-26. Versão major a confirmar no painel (D-22). |
| Jobs no banco | pg_cron (geração do pool, cotas da casa) | `cron.schedule_in_database` para bancos fora de `cron.database_name`. |
| Jobs da app | Vercel Cron (1 min) → rotas com `CRON_SECRET` | expiração, reconciliação (F5), alertas, antifraude. |
| Storage | Supabase Storage, bucket privado, URL assinada curta + audit log | substitui o S3/R2 do plano v1 (D-20). |
| Redis | Upstash (rate limit + cache). Dev/CI: Redis + `serverless-redis-http` (mesma API REST) | |
| UI | Tailwind 4 + shadcn/ui (`components.json` pronto) | |
| Validação | Zod 4 em env, API, forms, webhooks | |
| Auth admin | Auth.js Credentials + argon2id + TOTP; sessão 8h; reconfirmação de senha em ação sensível | Credentials exige JWT: `sessionVersion` no banco permite revogar. |
| E-mail | Resend (adapter) / Mailpit no dev | |
| Testes | Vitest (unit + integração com Postgres real **atrás do pgbouncer em modo transação**), Playwright 390x844 | |
| Erros | Sentry (F5) | |
| Geo | GeoJSON IBGE versionado + point-in-polygon no servidor; IP-UF pelos headers de geolocalização da Vercel (Q5); CEP via BrasilAPI com fallback ViaCEP | |

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
                │  checkout: geo → CPF → dados → bump → reserva
                │  admin (RBAC módulo×ação, TOTP, reauth)    │
                │  webhooks PSP · cron (CRON_SECRET)         │
                └──┬─────────────┬──────────────┬────────────┘
     pooler 6543   │             │              │
     role pa_app   │             │              │
          ┌────────▼────────┐ ┌──▼─────┐ ┌──────▼──────────┐
          │ Supabase PG (SP)│ │Upstash │ │ PaymentProvider │
          │ + pg_cron jobs: │ │ RL +   │ │ Mock (até F4)   │
          │  pool, casa     │ │ cache  │ │ real na F5      │
          └────────┬────────┘ └────────┘ └─────────────────┘
                   │
          Supabase Storage (privado) · Resend · Sentry
```

### 3.1 Código (estado após F0)

```
app/                      rotas (público, admin, api)
src/domain/               regras puras, sem I/O (ESLint bloqueia imports de infra)
src/allocator/            (F1) interface NumberAllocator + implementação Postgres
src/services/             (F1+) casos de uso transacionais
src/infra/                db (Prisma), redis, settings, storage, email, payments, geo
src/env/                  schema Zod do ambiente
src/ui/                   componentes (shadcn/ui)
prisma/                   schema, migrations (SQL manual incluso), seed
tests/{unit,integration,e2e}
docker/                   imagem Postgres com pg_cron, config do pgbouncer
docs/supabase-setup.md    checklist de contas (Supabase, Vercel, Upstash)
```

### 3.2 Ambientes
- `APP_ENV` validado por Zod no boot. `staging`: faixa "AMBIENTE DE HOMOLOGAÇÃO", `noindex`.
- `production`: `MockProvider`, `simulate-payment` e `geo_enforcement = off` **impossíveis** (checagem no código, não só na setting).

---

## 4. Modelo de dados (Prisma)

Convenções: tabelas e colunas em snake_case (`@@map`/`@map`); dinheiro em centavos (`Int`), somatórios em `BigInt`; `publicId` aleatório nas URLs; UTC no banco, "dia" em America/Fortaleza. A F0 já criou `settings` e `audit_log`; os demais modelos entram na fase em que são usados.

```prisma
// ── Enums ───────────────────────────────────────────────
enum AdminRole        { OWNER OPERATOR FINANCE SUPPORT }
enum CampaignStatus   { DRAFT GENERATING_NUMBERS PUBLISHED SALES_PAUSED SALES_CLOSED DRAWN FINISHED CANCELLED /* CANCELLED: D-04 */ }
enum DrawRule         { DEFAULT_6 /* DEFAULT_7: backlog */ }
enum UnsoldRule       { NEXT_PAID_CIRCULAR }
enum TicketStatus     { AVAILABLE RESERVED PAID HOUSE }
enum OrderStatus      { PENDING PAID EXPIRED CANCELLED REFUND_PENDING REFUNDED }
enum PaymentStatus    { PENDING PAID EXPIRED REFUNDED FAILED }
enum TerritorialRule  { PHYSICAL_LOCATION DOMICILE PHYSICAL_OR_DOMICILE }   // já na F0
enum GeoStep          { STEP0 STEP4 }
enum GeoResult        { APPROVED BLOCKED_OUTSIDE BLOCKED_PERMISSION BLOCKED_IP_DIVERGENCE BLOCKED_MOVED BLOCKED_CEP }
enum JobStatus        { PENDING RUNNING CANCEL_REQUESTED CANCELLED DONE FAILED }
enum HouseDirection   { BLOCK RELEASE }
enum WinnerType       { MAIN INSTANT_PRIZE RANKING }
enum WinnerStage      { NEW CONTACTED DOCS_RECEIVED DOCS_VALIDATED PRIZE_CHOSEN TAX_HANDLED DELIVERED PROOF_ATTACHED COMPLETED }
enum PrizeChoice      { GOODS CASH }
enum DocumentKind     { ID_DOCUMENT CPF_DOCUMENT ADDRESS_PROOF DELIVERY_PROOF TAX_GUIDE AUTHORIZATION }
enum FraudKind        { SHARED_PHONE SHARED_EMAIL SHARED_IP SHARED_DEVICE MANY_EXPIRED GPS_IP_DIVERGENCE PURCHASE_SPIKE }
enum ReviewStatus     { OPEN RELEASED CPF_BLOCKED ORDER_CANCELLED }
enum AlertKind        { PAYMENT_MISMATCH WEBHOOK_FAILING INSTANT_PRIZE_FOUND SALES_STALLED GEO_BLOCK_SPIKE CLAIM_DEADLINE JOB_FAILED }
enum AlertStatus      { OPEN ACKNOWLEDGED RESOLVED }
enum ContentKey       { TERMS PRIVACY FAQ }
enum ActorType        { ADMIN SYSTEM CUSTOMER }                              // já na F0

// ── Configuração (F0: criado) ───────────────────────────
model Settings {               // linha única, CHECK (id = 1)
  // marca, suporte, timezone, dados legais, show_authorization_badge,
  // authorized_state, territorial_rule, geo_enforcement, banner antigolpe  ← já existem
  // F2 acrescenta:
  stalledSalesMinutes Int?      // alerta "venda parada" (12.10)
  peakHours           Json?     // janelas de pico para o alerta
  alertEmails         String[]
  alertWhatsapps      String[]  // canal depende da Q8
}

model Modality { id Int @id; name String; organ String; allowsCashPrize Boolean @default(false); active Boolean }

model AdminUser {
  id String @id; email String @unique; name String; passwordHash String
  totpSecretEnc Bytes?; totpEnabledAt DateTime?; role AdminRole; active Boolean
  sessionVersion Int @default(0); failedLogins Int; lockedUntil DateTime?; lastLoginAt DateTime?
}

// ── Participantes ───────────────────────────────────────
model Customer {
  id BigInt @id; cpfHash String @unique; cpfEnc Bytes; cryptoKeyVersion Int
  fullName String; email String; phoneDdi String @default("55"); phone String; birthDate DateTime @db.Date
  cep String?; cepUf String? @db.Char(2)                        // só se territorial_rule aceitar domicílio
  marketingConsent Boolean @default(false); marketingConsentAt DateTime?; marketingRevokedAt DateTime?
  blockedAt DateTime?; blockedReason String?; anonymizedAt DateTime?
  @@index([email]) @@index([phone])                             // antifraude e busca do admin
}

// ── Campanha ────────────────────────────────────────────
model Campaign {
  id Int @id; slug String @unique; title String; description String; status CampaignStatus @default(DRAFT)
  featured Boolean
  modalityId Int?
  ticketPriceCents Int; totalTickets Int; minOrderValueCents Int     // travados após a 1ª reserva (trigger)
  maxPerOrder Int; maxPerCpf Int; reservationMinutes Int @default(15)
  quantityPresets Int[] @default([50, 100, 200, 500]); popularPreset Int? @default(100)
  drawDate DateTime?; lotteryContest Int?; drawRule DrawRule; unsoldRule UnsoldRule
  cashOptionEnabled Boolean @default(false); cashValueCents Int?      // trigger: só se modality.allowsCashPrize
  whatsappGroupUrl String?
  instantPrizesEnabled Boolean @default(false)
  showRanking Boolean @default(true); rankingPrizeEnabled Boolean @default(false); rankingPrizeText String?
  progressVisible Boolean; progressShowFromPct Int; progressRounding Int /* 1|5|10 */
  progressShowPct Boolean; progressShowRemaining Boolean; milestoneMessages Json
  transparencyNoteEnabled Boolean @default(true)
  transparencyNoteText String @default("Inclui números reservados pela organização, que não concorrem a prêmios.")
  salesPausedReason String?
  currentRegulationId String?; firstReservationAt DateTime?
  publishedAt DateTime?; salesClosedAt DateTime?; drawnAt DateTime?; finishedAt DateTime?
}

model CampaignAuthorization {    // aba 2: cadastro interno, obrigatório para publicar em production
  campaignId Int @id; promoterLegalName String; promoterCnpj String; modalityId Int; organ String
  number String; validFrom DateTime @db.Date; validUntil DateTime @db.Date; documentPath String?  // bucket privado
}

model CampaignMedia { id String @id; campaignId Int; type String /* IMAGE|VIDEO */; url String; alt String?; position Int }
model OrderBump     { id String @id; campaignId Int; position Int; extraTickets Int; priceCents Int; imageUrl String?; active Boolean
                      @@unique([campaignId, position]) }   // trigger: priceCents < extraTickets × preço
model InstantPrize  { id String @id; campaignId Int; number Int; description String; frozenAt DateTime?
                      winnerCaseId String?; @@unique([campaignId, number]) }
model RegulationVersion { id String @id; campaignId Int; version Int; kind String /* ORIGINAL|ERRATA */; errataReason String?
                          markdown String; sha256 String; pdfPath String?; pdfSha256 String; publishedAt DateTime?
                          @@unique([campaignId, version]) }
model MessageTemplate { id String @id; campaignId Int?; name String; body String; updatedById String }   // 12.11
model ContentPage     { id String @id; key ContentKey; version Int; markdown String; publishedAt DateTime? }

// ── Motor de números ────────────────────────────────────
model Ticket {                   // PK (campaign_id, number); campaign_id Int, order_id BigInt (economia de espaço)
  campaignId Int; number Int; shuffleRank Int; status TicketStatus @default(AVAILABLE)
  orderId BigInt?; reservedUntil DateTime?; isInstantPrize Boolean @default(false)
  @@id([campaignId, number])
  // SQL manual: índice (campaign_id, status, shuffle_rank) [SPEC 6.2];
  //   CHECK (NOT (is_instant_prize AND status = 'HOUSE'));  índice parcial PAID para apuração.
}
model CampaignCounter { campaignId Int; shard Int /* 0..15 */; paid Int; reserved Int; house Int; paidRevenueCents BigInt
                        @@id([campaignId, shard]) }
model PoolGenerationJob { id String @id; campaignId Int; status JobStatus; total Int; error String?
                          orderingSha256 String?   // hash de (number, shuffle_rank) ordenado: prova de não adulteração
                          requestedById String; startedAt DateTime?; finishedAt DateTime? }
model HouseJob { id String @id; campaignId Int; direction HouseDirection; mode String /* TARGET_PCT|EXACT */
                 targetPct Int?; requested Int; processed Int @default(0); batchSize Int @default(10000)
                 status JobStatus; error String?; createdById String; cancelledById String?; finishedAt DateTime? }

// ── Pedidos, pagamento, aceite, geolocalização ─────────
model Order {
  id BigInt @id; publicId String @unique; code String @unique; campaignId Int; customerId BigInt
  status OrderStatus; baseQuantity Int; bumpQuantity Int; quantity Int; amountCents Int
  expiresAt DateTime; paidAt DateTime?; latePayment Boolean
  refundReason String?; refundProofPath String?; refundRequestedById String?; refundApprovedById String?; refundedAt DateTime?
  deviceId String?; ip String; userAgent String
  @@index([campaignId, status, createdAt]) @@index([customerId, campaignId]) @@index([status, expiresAt])
  // SQL manual: UNIQUE (campaign_id, customer_id) WHERE status = 'PENDING'   [SPEC 5, 15, 19.7]
}
model OrderBumpSelection { orderId BigInt; bumpId String; extraTickets Int; priceCents Int; @@id([orderId, bumpId]) }
model Acceptance { id String @id; orderId BigInt @unique; regulationVersionId String; regulationSha256 String
                   termsVersion Int; ageDeclared Boolean; marketingConsent Boolean; ip String; userAgent String; acceptedAt DateTime }
model Payment { id String @id; orderId BigInt; provider String; providerChargeId String; txid String @unique
                amountCents Int; status PaymentStatus; pixCopyPaste String; expiresAt DateTime
                paidAt DateTime?; paidAmountCents Int?; endToEndId String?; feeCents Int? }
model WebhookEvent { id String @id; provider String; eventId String; payloadSha256 String; signatureValid Boolean
                     processedAt DateTime?; error String?; @@unique([provider, eventId]) }

model GeoCheck {                 // 13A: prova de compliance, uma linha por validação
  id String @id; campaignId Int; orderId BigInt?; customerId BigInt?; step GeoStep
  latitude Decimal? @db.Decimal(9, 6); longitude Decimal? @db.Decimal(9, 6); accuracyM Int?
  permission String /* GRANTED|DENIED|UNAVAILABLE */
  gpsUf String? @db.Char(2); ipUf String? @db.Char(2); ipCountry String?; gpsIpDistanceKm Int?
  cepUf String? @db.Char(2); result GeoResult; polygonVersion String; ip String; createdAt DateTime
  @@index([campaignId, result, createdAt])
}

// ── Ranking ─────────────────────────────────────────────
model ParticipantStat      { campaignId Int; customerId BigInt; paidTickets Int; reachedAt DateTime; @@id([campaignId, customerId]) }
model ParticipantDailyStat { campaignId Int; day DateTime @db.Date; customerId BigInt; paidTickets Int; reachedAt DateTime
                             @@id([campaignId, day, customerId]) }

// ── Apuração e ganhadores ───────────────────────────────
model Draw { id String @id; campaignId Int @unique; contestNumber Int; contestDate DateTime @db.Date; prizes String[]
             enteredById String; confirmedById String; drawnNumber Int; winningNumber Int; steps Json
             officialResultUrl String }                             // imutável (trigger)
model WinnerCase {               // 12.6: um fluxo por ganhador (principal, cota premiada, ranking)
  id String @id; campaignId Int; type WinnerType; customerId BigInt; orderId BigInt; number Int?; prize String
  stage WinnerStage @default(NEW); choice PrizeChoice?; city String?; uf String? @db.Char(2); suggestedUf String? @db.Char(2)
  claimDeadline DateTime; displayName String; deliveryVideoUrl String?; publishedAt DateTime?
}
model WinnerDocument { id String @id; caseId String; kind DocumentKind; storagePath String; sha256 String; uploadedById String; createdAt DateTime }
model TaxRecord { caseId String @id; baseCents BigInt; rateBasisPoints Int; amountCents BigInt; paidAt DateTime?; guideDocumentId String? }

// ── Antifraude e alertas ────────────────────────────────
model FraudSignal { id String @id; customerId BigInt; campaignId Int?; kind FraudKind; details Json; status ReviewStatus @default(OPEN)
                    reviewedById String?; reviewedAt DateTime?; createdAt DateTime; @@index([status, createdAt]) }
model Alert { id String @id; kind AlertKind; campaignId Int?; message String; payload Json; status AlertStatus @default(OPEN)
              notifiedAt DateTime?; acknowledgedById String?; createdAt DateTime; @@index([status, createdAt]) }

// ── Auditoria (F0: criado) ──────────────────────────────
model AuditLog { id BigInt @id; actorType ActorType; actorId String?; action String; entityType String; entityId String
                 campaignId Int?; before Json?; after Json?; reason String?; ip String?; createdAt DateTime }
```

### 4.1 Guardas no banco (SQL manual nas migrations)
| Regra | Mecanismo | Fase |
|---|---|---|
| audit log append-only | `pa_app` só SELECT/INSERT + trigger em UPDATE/DELETE/TRUNCATE (inclusive para o dono) | **F0 ✔** |
| App não burla travas por SQL | App conecta como `pa_app` (não é dono): não desabilita trigger nem altera schema | **F0 ✔** |
| Data API do Supabase fechada | revoke de `anon`/`authenticated` + remover `public` dos schemas expostos | **F0 ✔** |
| 1 reserva pendente por CPF/campanha | índice único parcial | F1 |
| Cota premiada ≠ casa | `CHECK (NOT (is_instant_prize AND status='HOUSE'))` | F1 |
| Travas pós-venda (preço, total, mínimo, regra) | trigger quando `first_reservation_at IS NOT NULL` | F1 (trigger) / F2 (UI) |
| Opção em dinheiro só com `allows_cash_prize` | trigger em `campaigns` | F2 |
| Order bump com desconto real | trigger `price_cents < extra_tickets × ticket_price_cents` | F3 |
| Apuração, cotas premiadas congeladas e regulamento publicado imutáveis | triggers | F2–F4 |

---

## 5. Motor de números

### 5.1 Interface (SPEC 6.1)
```ts
interface NumberAllocator {
  allocate(tx, { campaignId, orderId, quantity, reservedUntil }): Promise<number[]>;   // ou erro "restam N"
  release(tx, { campaignId, orderId }): Promise<number>;                                 // expiração/cancelamento
  confirm(tx, { campaignId, orderId }): Promise<number[]>;                              // RESERVED → PAID
  blockHouse({ campaignId, quantity, actorId }): Promise<{ jobId: string }>;            // assíncrono
  releaseHouse({ campaignId, quantity, actorId }): Promise<{ jobId: string }>;          // assíncrono
  stats(campaignId): Promise<{ paid; reserved; house; available; total }>;              // soma dos 16 shards
}
```
O resto da aplicação só conhece a interface. Uma implementação externa (numeração da loteria ou sistema certificado) substitui `PostgresNumberAllocator` sem tocar checkout, admin ou apuração.

### 5.2 Geração do pool (SPEC 6.3)
1. Publicar: valida as pendências (12.3), cria `PoolGenerationJob(PENDING)`, campanha → `GENERATING_NUMBERS`, responde na hora.
2. pg_cron (a cada minuto) chama `pa_process_pool_jobs()` (função PL/pgSQL, roda como dono):
   - pega 1 job `PENDING` com `FOR UPDATE SKIP LOCKED` → `RUNNING`;
   - `INSERT INTO tickets … SELECT $c, n, (random()*2147483646)::int, 'AVAILABLE', n = ANY(premiadas) FROM generate_series(0, total-1) n ON CONFLICT DO NOTHING`;
   - cria os 16 shards de contador, grava o `orderingSha256`, campanha → `PUBLISHED`, job → `DONE`;
   - em erro: job `FAILED` + mensagem, campanha → `DRAFT`, linha em `alerts`.
   Toda a geração ocorre numa única transação: ou existe o pool completo, ou nada (idempotência por construção + `ON CONFLICT`).
3. Admin mostra status (pendente, gerando, concluído, falhou + erro).
4. Estimativa: 1M de linhas em segundos, dentro do banco. Para 10M (DEFAULT_7, backlog), a mesma função passa a gerar em faixas, uma por execução.

### 5.3 Reserva (transação curta; travas só de transação)
```
fora da tx: Zod, honeypot, rate limit (IP+CPF), token geo do passo 0, revalidação geo do passo 4,
            CPF válido, 18+, CPF não bloqueado
BEGIN
  SET LOCAL statement_timeout = '5s'
  pg_advisory_xact_lock(campaign_id, customer_id)          -- serializa o mesmo CPF
  SELECT status FROM campaigns WHERE id=$c FOR SHARE       -- PUBLISHED; pausa/encerramento usam FOR UPDATE
  limites: qty ≤ max_per_order; pagos+pendentes+qty ≤ max_per_cpf; valor ≥ mínimo
  INSERT order (PENDING)                                    -- índice único parcial = 2ª barreira
  allocate(): CTE SELECT … ORDER BY shuffle_rank LIMIT qty FOR UPDATE SKIP LOCKED → UPDATE … RETURNING
  se < qty → ROLLBACK ("restam N cotas")
  UPDATE campaign_counters … WHERE shard = random(0..15)
  1ª reserva → first_reservation_at = now()                -- ativa as travas (trigger)
COMMIT
fora da tx: provider.createPixCharge(); se falhar → release + CANCELLED
```
Prisma: `$transaction(fn, { maxWait, timeout })` explícitos (D-21).

### 5.4 Pausar vendas (12.3)
`PUBLISHED → SALES_PAUSED` com `FOR UPDATE` na campanha + motivo + reconfirmação de senha + audit log. A reserva lê o status **no banco** (não no cache), então o bloqueio é imediato (< 5s com folga). Pagamentos de reservas existentes seguem normalmente. A página pública recebe `revalidateTag`; o aviso pode levar até o TTL do cache para aparecer, mas o CTA bloqueado é garantido pela API.

### 5.5 Cotas da casa (8.2, 19.9)
1. Admin escolhe alvo % ou quantidade exata → prévia (N cotas, P%, receita máxima A→B) → reconfirmação de senha.
2. Validação: alvo ≤ 95% e `disponíveis_após ≥ cotas mínimas por pedido`.
3. Cria `HouseJob(PENDING)`. pg_cron (`'2 seconds'`) chama `pa_process_house_jobs()`: **1 lote de 10.000 por execução e por transação** (`FOR UPDATE SKIP LOCKED`, `AND NOT is_instant_prize`, atualiza shards). Antes de cada lote, se o status for `CANCEL_REQUESTED`, encerra como `CANCELLED`.
4. Cancelar: `CANCEL_REQUESTED`. O lote em andamento termina (atomicidade), os seguintes não rodam. O estado fica consistente: cotas já bloqueadas permanecem `HOUSE` e aparecem no total; o admin vê "bloqueadas X de N, cancelado por Y".
5. Barra de progresso no admin = `processed / requested` (polling 2s).
6. Reservas em andamento nunca colidem: `SKIP LOCKED` pula linhas travadas. Se faltar estoque livre, o job conclui com o aplicado e informa a diferença.
7. Quantidade absoluta: o sistema nunca recalcula sozinho (D-05).

---

## 6. Territorialidade (13A)

| Etapa | Implementação |
|---|---|
| Passo 0 | `navigator.geolocation` (alta precisão, timeout 15s). O servidor recebe lat/lng/precisão, faz point-in-polygon contra o GeoJSON IBGE da `authorized_state` (versionado em `data/geo/`, simplificado e com hash) e compara com a UF do IP. Grava `GeoCheck` e devolve um **token assinado (HMAC, 20 min)** com o id do check. |
| Passos 1–3 | Exigem o token válido. |
| Passo 4 | Nova leitura do GPS + nova validação. Bloqueia se estiver fora da UF, se a permissão for negada, se houver divergência forte com o IP ou se a posição tiver se movido além da tolerância (Q7). Grava `GeoCheck(STEP4)` vinculado ao pedido. |
| Domicílio | Se `territorial_rule` aceitar domicílio: CEP → UF (BrasilAPI, fallback ViaCEP). `PHYSICAL_OR_DOMICILE`: aprova se GPS **ou** CEP estiver na UF. |
| Mensagens | "Esta campanha só pode ser adquirida por pessoas localizadas em {UF}." Texto de acordo com a regra. |
| Production | `geo_enforcement` forçado em `true` no código (`effectiveGeoEnforcement`, já na F0). |
| LGPD | Base legal: cumprimento de obrigação legal. A Política de Privacidade informa a coleta e a retenção. |
| Admin | Relatório de bloqueios por UF de origem + exportação dos `GeoCheck` (com audit log). |

**Limite técnico:** geolocalização do navegador pode ser falsificada (apps de GPS falso, devtools). O mecanismo é prova de diligência e barreira razoável, não garantia absoluta. Divergência GPS × IP também alimenta a fila de antifraude.

---

## 7. Apuração (SPEC 11)
- `domain/draw.ts` (pura): `DEFAULT_6 = últimos3(1º) ‖ últimos3(2º)` → 68003, 33062 → `003062`.
- Aproximação: próximo número `PAID` ≥ n; se não houver, volta ao início (circular). Casa, reservada e disponível nunca são `PAID`, então são puladas por construção. Passo a passo gravado em `Draw.steps`.
- Dupla digitação cega → divergência bloqueia → prévia → confirmação com reauth → `Draw` imutável, `WinnerCase(NEW)`, campanha `DRAWN`, audit log.
- DEFAULT_7: backlog. O teste `0030627` fica escrito como `it.todo`.

---

## 8. Admin (SPEC 12)

### 8.1 Acesso (12.1)
- Permissões = matriz **módulo × ação (ver, editar, exportar, aprovar)** por papel, versionada em código (`src/domain/permissions.ts`) e coberta por teste. Edição de papéis pelo admin fica para depois (D-34).
- Sessão de 8h; `sessionVersion` revoga. Reconfirmação de senha (válida 5 min) em: reembolso, exportação, cotas da casa, apuração, pausar/retomar vendas, revelar dados.
- Dashboard, Pedidos, Participante e Ganhadores projetados primeiro para 390px.

| Módulo | owner | operador | financeiro | suporte |
|---|---|---|---|---|
| Dashboard | ver | ver | ver | ver |
| Campanhas (dados, regulamento, ofertas, premiadas, ranking, progresso) | ver/editar | ver/editar | ver | ver |
| Autorização (cadastro interno e documento) | ver/editar | ver/editar | ver | — |
| Publicar / pausar / encerrar vendas | aprovar | aprovar | — | — |
| Cotas da casa | ver/editar | ver/editar | ver | — |
| Apuração | aprovar (confirmação) | editar (1ª digitação) | — | — |
| Pedidos | ver/editar | ver | ver/aprovar reembolso | ver + reenviar e-mail + cancelar pendente |
| Participante 360 / revelar / bloquear / exportar titular | tudo | ver/revelar | ver | ver/revelar |
| Ganhadores e entrega | tudo | ver/editar | editar IR e pagamento | ver/editar contato |
| Financeiro / conciliação / fechamento | tudo | — | tudo | — |
| Relatórios e exportações | exportar | exportar | exportar | — |
| Antifraude | tudo | ver/editar | ver | ver |
| Alertas | tudo | ver/reconhecer | ver/reconhecer | ver |
| Templates de mensagens | editar | editar | — | ver |
| Configurações, modalidades, territorialidade, usuários | editar | ver | — | — |
| Audit log | ver/exportar | ver | ver | — |

### 8.2 Módulos
| Seção | Pontos de implementação |
|---|---|
| 12.2 Dashboard | Agregados dos shards + tabelas de ranking; vendas por hora hoje × ontem a partir de `orders.paid_at` em America/Fortaleza; bloqueios geo por UF via `GeoCheck`. |
| 12.3 Campanhas | Checklist de publicação = função pura `publicationBlockers(campaign, settings, appEnv)` (regex `\[PREENCHER:` em regulamento, termos e política; autorização completa e vigente; `authorized_state`). Production bloqueia; dev/staging mostra aviso. |
| 12.4 Pedidos | Busca por CPF (pelo hash), nome, telefone, e-mail, código, txid, número da cota. Reembolso em 2 passos: solicitação (motivo + comprovante) → aprovação do financeiro. |
| 12.5 Participante | Mascarado por padrão; "revelar" pede reauth e grava audit log; exportação do titular (JSON + CSV); anonimização mantém o que a retenção legal exigir (D-16). |
| 12.6 Ganhadores | `WinnerCase` com etapas em sequência; documentos no bucket privado; "documentos validados" exige cidade/UF, com a UF sugerida vinda do `GeoCheck` do pedido; registro de IR; contagem do prazo de reclamação + alerta; publicação no resultado só após `DELIVERED`. |
| 12.7 Financeiro | Conciliação local × provider (pagos sem pedido, pedido sem pagamento, valor divergente, tardio); fechamento por campanha; CSV/XLSX. |
| 12.8 Relatórios | Exportações por campanha + modelo configurável para prestação de contas à loteria; todas no audit log. |
| 12.9 Antifraude | Job (cron 5 min) gera `FraudSignal` por regras SQL (mesmo telefone/e-mail/IP/dispositivo em vários CPFs, expirações em série, divergência GPS×IP, pico por CPF). Fila com liberar / bloquear CPF / cancelar pendente. |
| 12.10 Alertas | Tabela `alerts` + envio por e-mail (Resend). WhatsApp depende do provedor (Q8). |
| 12.11 Templates | Renderização com dados reais (shards, ranking, settings). Botão copiar. |
| 12.13 Audit log | Filtros por usuário, ação, campanha e período; exportável. |

---

## 9. Rotas

### 9.1 Públicas
| Rota | Render |
|---|---|
| `/` | ISR 60s |
| `/c/[slug]` | ISR + `revalidateTag`; dados vivos no cliente |
| `/c/[slug]/resultado`, `/resultados` | ISR |
| `/pedido/[publicId]` | dinâmica, `noindex` (PIX → confirmação) |
| `/meus-numeros` | dinâmica |
| `/termos`, `/privacidade`, `/faq` | ISR |

### 9.2 API
| Rota | Cache / proteção |
|---|---|
| `GET /api/health` | **F0 ✔** `no-store` |
| `GET /api/public/campaigns/[slug]/{live,ranking,instant-prizes}` | `s-maxage` 30/60s |
| `POST /api/checkout/geo` (passo 0) | RL IP; devolve o token geo |
| `POST /api/checkout/identify` (passo 1) | RL IP+CPF, honeypot, token geo |
| `POST /api/checkout/reserve` (passo 4) | RL, honeypot, Origin, token geo + revalidação |
| `GET /api/orders/[publicId]/status` | `no-store`, verificação lazy de expiração |
| `GET /api/orders/[publicId]/numbers.csv` | só `PAID` |
| `POST /api/orders/[publicId]/simulate-payment` | inexistente em production |
| `POST /api/meus-numeros/lookup` + `GET …/orders` | RL 5/15min IP e CPF; cookie assinado de 15 min |
| `POST /api/webhooks/payments/[provider]` | F5: assinatura + idempotência + valor/txid |
| `POST /api/cron/{expire-reservations, reconcile, fraud-scan, alerts}` | `CRON_SECRET` |

### 9.3 Admin
`/admin/{login,2fa,dashboard,campanhas,campanhas/[id]/{dados,autorizacao,regulamento,cotas-casa,ofertas,premiadas,ranking,progresso,apuracao},pedidos,participantes/[id],ganhadores,financeiro,relatorios,antifraude,alertas,templates,configuracoes,usuarios,auditoria}`

---

## 10. Segurança e LGPD
| Requisito | Como |
|---|---|
| CPF | AES-256-GCM com chave versionada + `cpfHash` (HMAC com pepper separada) |
| CPF digitado | `identify` devolve só `{known, "J***** V.", "(99) *****-3568", missing}`; CPF bloqueado → mensagem genérica; tempo de resposta constante |
| Cadastro existente | o checkout só completa campos vazios (D-12) |
| Logs | pino com redaction de PII; Sentry sem body e sem cookies |
| Headers | HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, `Permissions-Policy: geolocation=(self)` — **F0 ✔**; CSP com nonce na F1 |
| CSRF | Server Actions (origin check) + verificação de `Origin` nas rotas POST |
| Banco | role `pa_app` sem privilégios de dono; Data API do Supabase fechada — **F0 ✔** |
| Documentos | bucket privado; URL assinada de 60s; cada emissão de URL vai para o audit log |
| Dispositivo (antifraude) | cookie first-party com ID aleatório, sem fingerprinting (D-33, Q10) |

---

## 11. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | Edital da loteria impor numeração externa ou certificação | Retrabalho no motor | `NumberAllocator` isolado (SPEC 6.1). Nenhum módulo acessa `tickets` diretamente. |
| R-02 | **Geo por IP de operadora móvel é imprecisa no Brasil**: IPs de 4G (CGNAT) costumam aparecer em SP, RJ ou outro estado da operadora. "GPS na UF + IP em UF distante → bloquear" pode recusar compradores legítimos do MA em dados móveis. | Queda de conversão no canal principal (Instagram/WhatsApp no celular) | Implemento como na spec, com limiar configurável (distância e lista de UFs). Em staging, medir a taxa de divergência com tráfego real antes de ligar o bloqueio duro. Recomendação em Q6. |
| R-03 | GPS falsificado | Venda fora da UF | Divergência com IP + antifraude; registro como prova de diligência. |
| R-04 | Fricção do passo 0 (pedido de permissão antes do CPF) | Abandono no checkout | Tela curta explicando o motivo antes do prompt do navegador; instrução de como reativar a permissão; medir o abandono por etapa. |
| R-05 | Supabase expor tabelas pela Data API | Vazamento de PII | Revoke em migration (**F0 ✔**) + desligar no painel (checklist). |
| R-06 | Conexões no pooler com Fluid Compute (várias requisições por instância) | Esgotar conexões no pico | `connection_limit=5` por instância + monitorar o Supavisor; ajustar no teste k6 (D-26). |
| R-07 | Versão do Postgres: spec diz 16; o Supabase pode provisionar outra major | Diferença dev × prod | `PG_MAJOR` parametrizado no Docker (D-22). |
| R-08 | Contenção nos contadores | Timeouts no pico | 16 shards (SPEC 19.5). |
| R-09 | Enumeração de CPF no passo 1 | Vazamento parcial | RL, honeypot, token geo obrigatório (eleva o custo do ataque), Turnstile opcional (Q4). |
| R-10 | "Meus números" com CPF + nascimento | Exposição de números de terceiros | Sem PII na tela; RL; OTP no backlog. |
| R-11 | Insider altera a ordem do pool | Fraude em cotas premiadas | `orderingSha256` gravado na geração + audit log; admin não escolhe números. |
| R-12 | PSP congelar a conta | Receita retida | Provider real só com aceite escrito (SPEC 19.3); 2 adapters prontos. |
| R-13 | Repositório definitivo ainda não existe | CI do GitHub não validado | Código isolado em `pa-premios/`, pronto para mover com histórico (D-23). |

---

## 12. Perguntas abertas (máx. 10)

Bloqueiam a fase indicada. Cada uma traz minha recomendação.

| # | Pergunta | Recomendação | Bloqueia |
|---|---|---|---|
| Q1 | Reembolso: (a) antes do encerramento, os números voltam ao estoque? (b) depois, ficam não pagos (fora da apuração)? (c) pagamento tardio com a campanha encerrada: reembolso automático ou manual? | (a) sim, (b) sim, (c) manual com alerta | F1 |
| Q2 | Cotas do order bump contam para `max_per_order` e `max_per_cpf`? | Sim, para os dois | F3 |
| Q3 | Dupla digitação da apuração: dois usuários diferentes em production? | Sim: operador digita, owner confirma | F4 |
| Q4 | Cloudflare Turnstile no checkout e em "Meus números"? | Implementar desligado; ligar no 1º sinal de abuso | F1 |
| Q5 | UF por IP: usar os headers de geolocalização da Vercel (sem custo e sem enviar IP a terceiros) ou um provedor pago? | Headers da Vercel; reavaliar se a precisão medida em staging for ruim | F1 |
| Q6 | O que é "divergência forte" GPS × IP? Bloquear sempre ou só quando o IP for de fora do Brasil, ou de UF não vizinha a mais de X km? | Bloquear se o IP for de fora do Brasil, de VPN/datacenter ou de UF a mais de 1.000 km; nos demais casos, registrar como sinal de fraude. Validar com o jurídico e medir em staging. | F1 |
| Q7 | "Localização alterada entre o passo 0 e o passo 4": qual tolerância? | Bloquear se o passo 4 falhar na validação ou se a distância for maior que max(5 km, 3 × precisão informada) | F1 |
| Q8 | Alertas por WhatsApp para a equipe: qual provedor (WhatsApp Cloud API, Twilio, outro)? | E-mail na F2; WhatsApp Cloud API na F5 | F2 |
| Q9 | IR do ganhador: o sistema calcula (base × alíquota configurável) ou só registra o que o contador informa? | Só registrar na F2 (base, alíquota, valor, guia); cálculo depois, com regra do contador | F2 |
| Q10 | Antifraude "mesmo dispositivo": cookie first-party aleatório (simples, LGPD leve) ou biblioteca de fingerprint? | Cookie first-party | F2 |

---

## 13. Fases (SPEC 17)

| Fase | Entregáveis | Aceite | Status |
|---|---|---|---|
| **F0 — Setup** | Next 15 + TS strict + pnpm; Docker Compose (Postgres com pg_cron, pgbouncer em modo transação, Redis + REST, Mailpit); Prisma + migrations (settings, audit log append-only, role `pa_app`, pg_cron, lockdown da Data API); `APP_ENV`; faixa de staging; rodapé legal; `/api/health`; CI (format, lint, typecheck, drift, unit, integração, build, e2e); CLAUDE.md; checklist do Supabase | `pnpm dev` sobe; CI verde | **Concluída localmente.** CI do GitHub roda no 1º push ao repositório definitivo (R-13). |
| F1 — Núcleo de venda | página da campanha, seletor, geo (13A), checkout completo, `NumberAllocator`, pool via pg_cron, PIX mock, expiração, confirmação, e-mail, grupo do WhatsApp, suporte, banner antigolpe, Meus números | E2E mobile; testes da seção 15 (concorrência, pool, limites, 18+, CPF, geo) | aguardando |
| F2 — Admin | seção 12 completa | ver SPEC 17 | aguardando |
| F3 — Conversão | progresso + casa + nota, ranking, order bump, compartilhar, templates | testes da seção 15 | aguardando |
| F4 — Apuração | DEFAULT_6, aproximação, resultado, ganhadores | testes da seção 15 | aguardando |
| F5 — Produção | PIX real, webhooks, reconciliação, rate limit, Sentry, backups, k6 | metas da seção 14 | aguardando |

Diretrizes de UI: alvos de toque ≥ 44px, texto ≥ 16px, contraste AA, `prefers-reduced-motion`, ícones Lucide, barra fixa com `safe-area-inset-bottom`, botão de suporte acima da barra sem cobrir conteúdo, cores e logo de `settings`.

---

## 14. Oportunidades (não implementar sem aprovação)
1. Funil por etapa do checkout (geo → CPF → dados → bump → PIX → pago) no dashboard: mostra onde o passo 0 está custando vendas.
2. Lembrete de reserva expirada por e-mail transacional (validar a base legal).
3. Página pública de auditoria por campanha (hash do regulamento, `orderingSha256`, contagem final por status).
4. UTM e origem por pedido (qual story ou grupo gera receita).
