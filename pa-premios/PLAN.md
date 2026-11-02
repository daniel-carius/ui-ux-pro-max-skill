# PLAN.md — Plataforma de campanhas "P.A PRÊMIOS"

> Status: **PROPOSTA — aguardando aprovação.** Nenhum código de aplicação foi escrito.
> Data: 2026-11-02 · Spec de referência: SPEC enviada no chat (seções 0–18).
> Decisões com default conservador estão em [`DECISIONS.md`](./DECISIONS.md).
> As 10 perguntas bloqueantes estão na **seção 10**. Responda primeiro as Q1–Q4: sem elas a F0 não começa.

---

## 1. Resumo executivo

| Item | Proposta |
|---|---|
| Arquitetura | Monólito Next.js 15 (App Router) + PostgreSQL 16 + Redis. Sem microsserviços. |
| Ponto crítico | Motor de números: pool pré-gerado + `FOR UPDATE SKIP LOCKED` em SQL cru, numa transação curta. |
| Gargalo previsto | Linha "quente" de contadores. Resolvido com **contadores particionados (16 shards)**. |
| Escala pública | Página de campanha estática (ISR) + endpoints "vivos" com cache na CDN (`s-maxage`). Os 300 req/s caem quase todos na CDN. O banco só recebe as reservas. |
| Maior risco | **Jurídico, não técnico**: modalidade da autorização, aceite do PSP e cotas da casa (seção 9). |
| Fora do escopo agora | Seção 18 da spec, sem alteração. |

---

## 2. Stack e alternativas propostas

Mantenho a stack da seção 2. Os ajustes abaixo são **acréscimos ou detalhamentos**, não trocas.

| Tema | Decisão | Por quê |
|---|---|---|
| Storage de mídia/PDF | Adapter S3-compatível (Cloudflare R2 ou S3 em prod; **MinIO** no Docker Compose) | A spec não define onde ficam imagens, vídeo e PDFs do regulamento. |
| Geração do pool | Em **lotes de 100k via SQL `generate_series`**, um lote por execução do cron (ou worker) | 1M de linhas não cabe com segurança numa única função serverless; em lotes é retomável e idempotente. |
| Alocação | `prisma.$queryRaw` com CTE `SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE … RETURNING` numa única instrução | O Prisma não expressa `SKIP LOCKED`. Uma única instrução reduz a ida e volta ao banco. |
| Particionamento de `tickets` | `PARTITION BY LIST (campaign_id)` via migration SQL manual | Campanhas encerradas viram partições arquiváveis; índice menor por campanha. O Prisma não gera partição; a migration é escrita à mão. |
| Sessão admin | Auth.js Credentials (exige JWT) + `session_version` no banco checado a cada request | Credentials não suporta sessão em banco; o `session_version` permite derrubar sessões (troca de senha, desligamento). |
| Hash de senha | `@node-rs/argon2` (argon2id) | Binário pré-compilado, funciona em serverless sem toolchain nativa. |
| TOTP | `otplib` + segredo criptografado (AES-256-GCM) | Padrão de mercado; compatível com Google Authenticator e afins. |
| PDF do regulamento | `@react-pdf/renderer` (sem Chromium) | Headless Chrome é pesado e instável em serverless. |
| Markdown | `remark` → `rehype-sanitize` (allowlist) → HTML | Renderizado e sanitizado; nunca exibido cru. |
| Rate limit | `@upstash/ratelimit` (Redis local compatível no dev) | Sliding window por IP e por CPF-hash. |
| Logs | `pino` com redaction de PII (cpf, email, phone, name, birthDate) | Atende "logs sem PII" por padrão, não por disciplina. |
| Anti-bot (opcional) | Cloudflare Turnstile **desligado por padrão**, ligável em settings | Ver Q10: mitiga enumeração de CPF em picos. |
| CI | GitHub Actions: lint, typecheck, unit, integração (service Postgres 16 + Redis), Playwright | Critério de aceite da F0. |

---

## 3. Arquitetura

```
                ┌───────────── CDN (Vercel Edge) ──────────────┐
 Instagram /    │  /c/[slug]  ISR (revalidateTag no admin)     │
 WhatsApp  ───▶ │  /api/public/*/live      s-maxage=30, SWR    │
 (mobile)       │  /api/public/*/ranking   s-maxage=60, SWR    │
                └───────────────┬──────────────────────────────┘
                                │ miss / dinâmico
                ┌───────────────▼──────────────────────────────┐
                │ Next.js (Route Handlers + Server Actions)    │
                │  checkout ─ reserva ─ status ─ meus números  │
                │  admin (Auth.js + TOTP + RBAC)               │
                │  webhooks PSP ─ cron (segredo no header)     │
                └──┬──────────────┬──────────────┬─────────────┘
                   │              │              │
            ┌──────▼─────┐  ┌─────▼────┐  ┌──────▼──────────┐
            │ Postgres 16│  │  Redis   │  │ PaymentProvider │
            │ (pooler)   │  │ RL+cache │  │ Mock|Efí|Asaas|MP│
            └────────────┘  └──────────┘  └─────────────────┘
                   │
            S3/R2 (mídia, PDFs) · Resend (e-mail) · Sentry
```

### 3.1 Organização do código

```
pa-premios/
├── app/
│   ├── (public)/            # home, c/[slug], resultados, meus-numeros, pedido/[publicId], termos…
│   ├── admin/               # páginas do admin (RSC + server actions)
│   └── api/
│       ├── public/          # endpoints vivos com cache
│       ├── checkout/        # identify, reserve
│       ├── orders/          # status, csv, simulate-payment (não-prod)
│       ├── webhooks/        # payments/[provider]
│       └── cron/            # expire, reconcile, generate-pool, retention
├── src/
│   ├── domain/              # regras puras (sem I/O): limites, apuração, máscara, progresso
│   ├── services/            # casos de uso com transação: reservar, pagar, expirar, casa, apurar
│   ├── infra/               # prisma, redis, storage, email, payments/*, crypto
│   ├── schemas/             # Zod (API, forms, webhooks, env)
│   └── ui/                  # componentes (shadcn/ui)
├── prisma/                  # schema.prisma, migrations (incl. SQL manual), seed.ts
├── tests/                   # unit, integration (Postgres real), e2e (Playwright 390x844)
├── docker-compose.yml       # postgres, redis, mailpit, minio
└── CLAUDE.md, PLAN.md, DECISIONS.md
```

Regra de camadas: `domain/` não importa nada de `infra/`. Toda regra de negócio crítica (apuração, limites, cotas da casa, máscara) fica em `domain/` com teste unitário puro.

### 3.2 Configuração e ambientes
- `env.ts` com Zod: falha no boot se faltar variável. `APP_ENV = development | staging | production`.
- Textos de marca, telefone e links: **somente** da tabela `settings` (cache Redis 60s, invalidado ao salvar).
- `staging`: faixa fixa "AMBIENTE DE HOMOLOGAÇÃO"; `MockProvider` permitido. `production`: `MockProvider` e `simulate-payment` **bloqueados no boot**.

---

## 4. Modelo de dados (Prisma)

Convenções:
- Dinheiro sempre em **centavos (Int)**; somatórios em `BigInt`.
- `tickets` usa `campaign_id Int` e `order_id BigInt` (e não UUID) para economizar ~40 bytes/linha: 1M de linhas ≈ 150 MB com índices; 10M ≈ 1,5 GB.
- IDs expostos na URL são `publicId` aleatórios (128 bits). IDs internos nunca aparecem no front.
- Horários em UTC; "dia" calculado em `America/Fortaleza` (UTC−3, sem horário de verão).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // via pooler
  directUrl = env("DIRECT_URL")     // migrations
}

enum AdminRole        { OWNER OPERATOR FINANCE SUPPORT }
enum CampaignStatus   { DRAFT POOL_GENERATING ACTIVE SALES_CLOSED DRAWN FINISHED CANCELLED }
enum DrawRule         { DEFAULT_6 DEFAULT_7 }
enum UnsoldRule       { NEXT_PAID_CIRCULAR }
enum TicketStatus     { AVAILABLE RESERVED PAID HOUSE }
enum OrderStatus      { PENDING PAID EXPIRED CANCELLED REFUND_PENDING REFUNDED }
enum PaymentStatus    { PENDING PAID EXPIRED REFUNDED FAILED }
enum ProgressRounding { ONE FIVE TEN }
enum MediaType        { IMAGE VIDEO }
enum RegulationKind   { ORIGINAL ERRATA }
enum WinnerType       { MAIN INSTANT_PRIZE RANKING }
enum ContentKey       { TERMS PRIVACY FAQ }
enum HouseMode        { TARGET_PCT EXACT }
enum ActorType        { ADMIN SYSTEM CUSTOMER }

// ───────────── Configuração ─────────────
model Settings {
  id                      Int      @id @default(1)        // linha única
  brandName               String
  logoUrl                 String?
  primaryColor            String
  secondaryColor          String
  supportWhatsapp         String
  supportMessageTemplate  String   // "Olá! Preciso de ajuda com minha compra na {brand_name}"
  whatsappGroupUrlDefault String?
  timezone                String   @default("America/Fortaleza")
  legalName               String?
  cnpj                    String?
  address                 String?
  sacEmail                String?
  dpoName                 String?
  dpoEmail                String?
  antiScamEnabled         Boolean  @default(true)
  antiScamText            String
  pixExpirationMinutes    Int      @default(15)
  turnstileEnabled        Boolean  @default(false)
  dataRetentionDays       Int?     // null = sem expurgo automático
  updatedAt               DateTime @updatedAt
  updatedById             String?
}

model Modality {
  id              Int        @id @default(autoincrement())
  name            String
  organ           String
  allowsCashPrize Boolean    @default(false)
  active          Boolean    @default(true)
  campaigns       Campaign[]
}

model AdminUser {
  id             String    @id @default(cuid())
  email          String    @unique
  name           String
  passwordHash   String
  totpSecretEnc  Bytes?
  totpEnabledAt  DateTime?            // sem TOTP ativo = só acessa a tela de setup do 2FA
  role           AdminRole
  active         Boolean   @default(true)
  sessionVersion Int       @default(0)
  failedLogins   Int       @default(0)
  lockedUntil    DateTime?
  lastLoginAt    DateTime?
  createdAt      DateTime  @default(now())
}

// ───────────── Participantes ─────────────
model Customer {
  id                   BigInt    @id @default(autoincrement())
  cpfHash              String    @unique            // HMAC-SHA256(pepper, cpf)
  cpfEnc               Bytes                        // AES-256-GCM
  cryptoKeyVersion     Int
  fullName             String
  email                String
  phoneDdi             String    @default("55")
  phone                String
  birthDate            DateTime  @db.Date
  city                 String?                      // preenchido na validação do ganhador (ver DECISIONS D-14)
  uf                   String?   @db.Char(2)
  marketingConsent     Boolean   @default(false)
  marketingConsentAt   DateTime?
  marketingRevokedAt   DateTime?
  blockedAt            DateTime?
  blockedReason        String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  orders               Order[]
  acceptances          Acceptance[]
}

// ───────────── Campanha ─────────────
model Campaign {
  id                    Int            @id @default(autoincrement())
  slug                  String         @unique
  title                 String
  description           String                       // markdown
  status                CampaignStatus @default(DRAFT)
  featured              Boolean        @default(false) // hero da home
  modalityId            Int?
  modality              Modality?      @relation(fields: [modalityId], references: [id])
  authorizationNumber   String?
  authorizationUrl      String?
  promoterLegalName     String?
  promoterCnpj          String?
  ticketPriceCents      Int                          // travado após 1ª reserva
  totalTickets          Int                          // travado
  minOrderValueCents    Int                          // travado
  maxTicketsPerOrder    Int
  maxTicketsPerCustomer Int
  quantityPresets       Int[]          @default([50, 100, 200, 500])
  popularPreset         Int?           @default(100)
  drawDate              DateTime?
  lotteryContest        Int?
  drawRule              DrawRule                     // travado
  unsoldRule            UnsoldRule     @default(NEXT_PAID_CIRCULAR)
  cashOptionEnabled     Boolean        @default(false) // só se modality.allowsCashPrize
  cashValueCents        Int?
  whatsappGroupUrl      String?
  instantPrizesEnabled  Boolean        @default(false)
  rankingPrizeEnabled   Boolean        @default(false)
  rankingPrizeText      String?
  progressVisible       Boolean        @default(true)
  progressShowFromPct   Int            @default(0)
  progressRounding      ProgressRounding @default(ONE)
  progressShowPct       Boolean        @default(true)
  progressShowRemaining Boolean        @default(false)
  milestoneMessages     Json                         // {"25": "...", "50": "...", "75": "...", "90": "...", "last": "Últimas cotas!"}
  poolGeneratedUpTo     Int            @default(0)   // progresso da geração em lotes
  poolSeedHash          String?                      // SHA-256 da seed do embaralhamento (ver DECISIONS D-07)
  currentRegulationId   String?        @unique
  firstReservationAt    DateTime?                    // dispara as travas
  publishedAt           DateTime?
  salesClosedAt         DateTime?
  drawnAt               DateTime?
  finishedAt            DateTime?
  createdAt             DateTime       @default(now())
  updatedAt             DateTime       @updatedAt

  media         CampaignMedia[]
  bumps         OrderBump[]
  instantPrizes InstantPrize[]
  regulations   RegulationVersion[] @relation("CampaignRegulations")
  orders        Order[]
  draw          Draw?
  winners       Winner[]
  @@index([status, featured])
}

model CampaignMedia {
  id         String    @id @default(cuid())
  campaignId Int
  campaign   Campaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  type       MediaType
  url        String
  alt        String?
  position   Int       // até 8 imagens + 1 vídeo (validado no serviço)
}

model OrderBump {
  id           String   @id @default(cuid())
  campaignId   Int
  campaign     Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  position     Int      // 1 ou 2
  extraTickets Int
  priceCents   Int      // CHECK: priceCents < extraTickets * ticketPriceCents
  imageUrl     String?
  active       Boolean  @default(false)
  @@unique([campaignId, position])
}

model InstantPrize {
  id               String    @id @default(cuid())
  campaignId       Int
  campaign         Campaign  @relation(fields: [campaignId], references: [id])
  number           Int
  description      String
  frozenAt         DateTime? // preenchido na publicação; depois disso é imutável
  winnerCustomerId BigInt?
  winnerOrderId    BigInt?
  wonAt            DateTime?
  @@unique([campaignId, number])
}

model RegulationVersion {
  id           String         @id @default(cuid())
  campaignId   Int
  campaign     Campaign       @relation("CampaignRegulations", fields: [campaignId], references: [id])
  version      Int
  kind         RegulationKind @default(ORIGINAL)
  errataReason String?
  markdown     String         // texto final, variáveis já resolvidas
  sha256       String         // hash do markdown canônico (NFC, LF)
  pdfUrl       String?
  pdfSha256    String?
  createdById  String
  publishedAt  DateTime?
  createdAt    DateTime       @default(now())
  @@unique([campaignId, version])
}

// ───────────── Pedidos e pagamento ─────────────
model Order {
  id             BigInt      @id @default(autoincrement())
  publicId       String      @unique              // 128 bits, usado na URL /pedido/[publicId]
  code           String      @unique              // curto e legível: "PA-7KX92Q"
  campaignId     Int
  campaign       Campaign    @relation(fields: [campaignId], references: [id])
  customerId     BigInt
  customer       Customer    @relation(fields: [customerId], references: [id])
  status         OrderStatus @default(PENDING)
  baseQuantity   Int
  bumpQuantity   Int         @default(0)
  quantity       Int                               // base + bumps
  amountCents    Int
  expiresAt      DateTime
  paidAt         DateTime?
  latePayment    Boolean     @default(false)
  refundReason   String?
  refundProofUrl String?
  refundedAt     DateTime?
  refundedById   String?
  createdAt      DateTime    @default(now())

  bumps      OrderBumpSelection[]
  payments   Payment[]
  acceptance Acceptance?
  @@index([campaignId, status, createdAt])
  @@index([customerId, campaignId])
  @@index([status, expiresAt])
  // SQL manual: CREATE UNIQUE INDEX one_pending_per_customer
  //   ON "Order"("campaignId","customerId") WHERE status = 'PENDING';
}

model OrderBumpSelection {
  orderId      BigInt
  order        Order  @relation(fields: [orderId], references: [id])
  bumpId       String
  extraTickets Int
  priceCents   Int    // snapshot do preço no momento da compra
  @@id([orderId, bumpId])
}

model Acceptance {
  id                  String   @id @default(cuid())
  orderId             BigInt   @unique
  order               Order    @relation(fields: [orderId], references: [id])
  customerId          BigInt
  customer            Customer @relation(fields: [customerId], references: [id])
  regulationVersionId String
  regulationSha256    String
  termsVersion        Int
  ageDeclared         Boolean
  marketingConsent    Boolean
  ip                  String
  userAgent           String
  acceptedAt          DateTime @default(now())
}

model Payment {
  id               String        @id @default(cuid())
  orderId          BigInt
  order            Order         @relation(fields: [orderId], references: [id])
  provider         String        // mock | efi | asaas | mercadopago
  providerChargeId String
  txid             String        @unique
  amountCents      Int
  status           PaymentStatus @default(PENDING)
  pixCopyPaste     String
  expiresAt        DateTime
  paidAt           DateTime?
  paidAmountCents  Int?
  endToEndId       String?
  createdAt        DateTime      @default(now())
  @@unique([provider, providerChargeId])
  @@index([status, createdAt])
}

model WebhookEvent {
  id             String    @id @default(cuid())
  provider       String
  eventId        String
  payloadSha256  String
  signatureValid Boolean
  receivedAt     DateTime  @default(now())
  processedAt    DateTime?
  error          String?
  @@unique([provider, eventId])   // idempotência
}

// ───────────── Motor de números ─────────────
// Tabela particionada por campaign_id (migration SQL manual).
model Ticket {
  campaignId     Int
  number         Int
  shuffleRank    Int
  status         TicketStatus @default(AVAILABLE)
  orderId        BigInt?
  reservedUntil  DateTime?
  isInstantPrize Boolean      @default(false)
  @@id([campaignId, number])
  // SQL manual:
  //  idx_avail  ON tickets(campaign_id, shuffle_rank) WHERE status='AVAILABLE'
  //  idx_order  ON tickets(order_id) WHERE order_id IS NOT NULL
  //  idx_paid   ON tickets(campaign_id, number)       WHERE status='PAID'      -- apuração
  //  idx_house  ON tickets(campaign_id, shuffle_rank) WHERE status='HOUSE'
  //  idx_resexp ON tickets(campaign_id, reserved_until) WHERE status='RESERVED'
}

model CampaignCounter {          // 16 shards por campanha; leitura = SUM
  campaignId       Int
  shard            Int
  paid             Int    @default(0)
  reserved         Int    @default(0)
  house            Int    @default(0)
  paidRevenueCents BigInt @default(0)
  @@id([campaignId, shard])
}

model ParticipantStat {          // ranking geral (casa nunca entra: só pedidos pagos)
  campaignId  Int
  customerId  BigInt
  paidTickets Int
  reachedAt   DateTime         // momento em que atingiu o total atual (desempate)
  @@id([campaignId, customerId])
  @@index([campaignId, paidTickets(sort: Desc), reachedAt])
}

model ParticipantDailyStat {     // ranking do dia (dia em America/Fortaleza)
  campaignId  Int
  day         DateTime @db.Date
  customerId  BigInt
  paidTickets Int
  reachedAt   DateTime
  @@id([campaignId, day, customerId])
  @@index([campaignId, day, paidTickets(sort: Desc), reachedAt])
}

model HouseAdjustment {
  id           String    @id @default(cuid())
  campaignId   Int
  mode         HouseMode
  targetPct    Int?
  requested    Int       // + bloquear / − devolver
  applied      Int       // efetivamente aplicado
  houseBefore  Int
  houseAfter   Int
  createdById  String
  createdAt    DateTime  @default(now())
}

// ───────────── Apuração e ganhadores ─────────────
model Draw {
  id                 String   @id @default(cuid())
  campaignId         Int      @unique
  campaign           Campaign @relation(fields: [campaignId], references: [id])
  contestNumber      Int
  contestDate        DateTime @db.Date
  prizes             String[] // 5 prêmios, 5 dígitos cada, conferidos por dupla digitação
  enteredById        String
  confirmedById      String
  drawnNumber        Int      // número calculado pela regra
  winningNumber      Int      // após aproximação
  steps              Json     // passo a passo exibido na página de resultado
  winnerOrderId      BigInt
  officialResultUrl  String
  deliveryVideoUrl   String?
  createdAt          DateTime @default(now())
}

model Winner {
  id          String     @id @default(cuid())
  campaignId  Int
  campaign    Campaign   @relation(fields: [campaignId], references: [id])
  type        WinnerType
  customerId  BigInt
  orderId     BigInt
  number      Int?
  prize       String
  displayName String     // snapshot mascarado "Jamilson V."
  city        String?
  uf          String?
  published   Boolean    @default(false)
  wonAt       DateTime
  deliveredAt DateTime?
}

// ───────────── Conteúdo e auditoria ─────────────
model ContentPage {
  id          String     @id @default(cuid())
  key         ContentKey
  version     Int
  markdown    String
  publishedAt DateTime?
  createdById String
  @@unique([key, version])
}

model AuditLog {                  // append-only: trigger bloqueia UPDATE/DELETE
  id         BigInt    @id @default(autoincrement())
  actorType  ActorType
  actorId    String?
  action     String    // ex.: campaign.publish, house.adjust, draw.compute, participants.export
  entityType String
  entityId   String
  before     Json?     // sem PII em claro (redaction no serviço)
  after      Json?
  ip         String?
  createdAt  DateTime  @default(now())
  @@index([entityType, entityId, createdAt])
}
```

Proteções em nível de banco (migrations SQL manuais):
1. `audit_log`: trigger `BEFORE UPDATE OR DELETE → RAISE EXCEPTION`; o role da aplicação também não recebe `UPDATE/DELETE` nessa tabela.
2. `tickets`: `CHECK (NOT (is_instant_prize AND status = 'HOUSE'))`, ou seja, uma cota premiada nunca vira cota da casa, nem por bug.
3. `orders`: índice único parcial "1 pendente por CPF por campanha".
4. `order_bumps`: trigger valida `price_cents < extra_tickets * ticket_price_cents` (segunda barreira além do Zod).
5. `campaigns`: trigger impede alterar `ticket_price_cents`, `total_tickets`, `min_order_value_cents` e `draw_rule` quando `first_reservation_at IS NOT NULL`.
6. `draws`, `instant_prizes` (após `frozen_at`) e `regulation_versions` (após `published_at`): imutáveis via trigger.

---

## 5. Motor de números (seção 6): desenho detalhado

### 5.1 Geração do pool (publicação)
1. `DRAFT → POOL_GENERATING`. Grava-se `poolSeedHash` (D-07).
2. Cron `generate-pool` (a cada 1 min, ou em loop no worker) insere um lote de 100k por execução:
   ```sql
   INSERT INTO tickets (campaign_id, number, shuffle_rank, status, is_instant_prize)
   SELECT $1, n, permute(n, $seed), 'AVAILABLE', n = ANY($instant_numbers)
   FROM generate_series($from, $to) n
   ON CONFLICT DO NOTHING;           -- idempotente: pode reexecutar
   ```
   `permute` = permutação pseudoaleatória determinística (Feistel com seed secreta), o que permite auditar o embaralhamento depois da apuração.
3. Ao completar `totalTickets`, valida-se `COUNT(*) = total` (uma única vez, no admin), os 16 shards são criados zerados e a campanha passa para `ACTIVE`.
4. Estimativa: 1M de linhas em ~10–20 s no total (10 lotes). Para 10M (DEFAULT_7), ver o risco R-04.

### 5.2 Reserva (transação curta, timeout de 10 s)
```
0. Fora da transação: Zod, honeypot, rate limit (IP e CPF), CPF válido, 18+, cliente não bloqueado.
BEGIN
1. pg_advisory_xact_lock(hash(campaign_id, customer_id))      -- serializa o MESMO CPF
2. SELECT campanha FOR SHARE; exige status=ACTIVE              -- o encerramento usa FOR UPDATE
3. Se houver pedido PENDING desse CPF → recusa (índice único parcial como 2ª barreira)
4. pagos_do_cpf + qty ≤ maxTicketsPerCustomer ; qty ≤ maxTicketsPerOrder ; valor ≥ mínimo
5. INSERT order (PENDING, expires_at = now + pixExpirationMinutes)
6. WITH picked AS (
     SELECT number FROM tickets
      WHERE campaign_id=$c AND status='AVAILABLE'
      ORDER BY shuffle_rank LIMIT $qty
      FOR UPDATE SKIP LOCKED)
   UPDATE tickets t SET status='RESERVED', order_id=$o, reserved_until=$exp
     FROM picked p WHERE t.campaign_id=$c AND t.number=p.number
   RETURNING t.number;
7. Se retornou < qty → ROLLBACK, com a resposta "restam N cotas" (o front oferece N)
8. UPDATE campaign_counters SET reserved = reserved + qty WHERE shard = random(0..15)
9. Se for a 1ª reserva: UPDATE campaigns SET first_reservation_at = now()
COMMIT
10. Fora da transação: provider.createPixCharge(). Se falhar → cancela o pedido e libera os números.
```
Por que a cobrança PIX fica fora da transação: chamada de rede dentro da transação segura locks por segundos e derruba a vazão.

### 5.3 Pagamento, expiração e pagamento tardio
- **Confirmação** (webhook ou reconciliação): `SELECT order FOR UPDATE` → confere valor e txid → `RESERVED→PAID` → contadores (`reserved−`, `paid+`, receita) → `ParticipantStat` e `ParticipantDailyStat` (UPSERT) → checa cotas premiadas → commit → e-mail (fora da transação, com retry).
- **Expiração**: cron a cada 1 min + verificação lazy quando o front consulta o status. Ambos travam o pedido com `FOR UPDATE`, então a disputa com um webhook simultâneo é resolvida pela ordem de chegada no lock.
- **Pagamento tardio**: pedido `EXPIRED` + pagamento válido → tenta realocar `qty` novos números pelo mesmo CTE. Se não houver estoque, ou se a campanha não estiver `ACTIVE` → `REFUND_PENDING` + alerta ao admin (e-mail + item no dashboard).

### 5.4 Cotas da casa (seção 8.2)
- Alvo T% → `necessárias = ceil(T × total) − pagas − casa_atual`.
  - `> 0`: aloca pelo mesmo CTE com `status='HOUSE'` e o filtro extra `AND NOT is_instant_prize`.
  - `< 0`: devolve `HOUSE→AVAILABLE` (`ORDER BY shuffle_rank DESC … FOR UPDATE SKIP LOCKED`).
- Validações antes da prévia: `T ≤ 95` e `disponíveis_após ≥ cotas_mínimas_por_pedido`.
- Prévia: "Serão bloqueadas N cotas (P% do total). Receita máxima cai de R$ A para R$ B." O admin confirma, o sistema aplica, grava `HouseAdjustment` + `AuditLog`.
- A casa é uma **quantidade absoluta**: o sistema nunca recalcula sozinho conforme as vendas sobem (D-05).
- Se houver reservas em andamento, o `SKIP LOCKED` simplesmente as ignora. Se o estoque livre não bastar, aplica-se o possível e a diferença é informada (teste da seção 15).

---

## 6. Apuração (seção 11)

Função pura em `domain/draw.ts`, com teste unitário exaustivo:

```
DEFAULT_6: n = últimos3(1º) ‖ últimos3(2º)            → 68003, 33062 → "003062"
DEFAULT_7: n = DEFAULT_6 ‖ algarismo(3º, posição ?)   → AGUARDA Q5
```

Aproximação (`NEXT_PAID_CIRCULAR`):
```sql
SELECT number FROM tickets
 WHERE campaign_id=$c AND status='PAID' AND number >= $n
 ORDER BY number LIMIT 1;
-- se vazio: mesmo SELECT com number >= 0 (volta ao início)
```
Cotas da casa, reservadas e disponíveis nunca têm `status='PAID'`, portanto são puladas por construção. O `steps` registra: número calculado → status encontrado ("da casa" ou "não vendido") → próximo pago → ganhador.

Fluxo no admin: digitação 1 → digitação 2 (campos cegos) → divergência bloqueia → prévia do passo a passo → confirmação → `Draw` imutável + `Winner` + `status=DRAWN` + audit log.

---

## 7. Rotas

### 7.1 Públicas (páginas)
| Rota | Render | Observação |
|---|---|---|
| `/` | ISR 60s | hero da campanha `featured` + abas Ativas/Encerradas + ganhadores |
| `/c/[slug]` | ISR + `revalidateTag(campaign:{id})` | dados vivos via fetch no cliente |
| `/c/[slug]/resultado` | ISR | após `DRAWN` |
| `/resultados` | ISR 300s | |
| `/pedido/[publicId]` | dinâmica, `noindex` | tela PIX → confirmação; o cliente pode reabrir |
| `/meus-numeros` | dinâmica | CPF + nascimento |
| `/termos`, `/privacidade`, `/faq` | ISR | `ContentPage` vigente |

### 7.2 API
| Método e rota | Cache | Proteção |
|---|---|---|
| `GET /api/public/campaigns/[slug]/live` | `s-maxage=30, swr` | progresso + marco |
| `GET /api/public/campaigns/[slug]/ranking` | `s-maxage=60, swr` | |
| `GET /api/public/campaigns/[slug]/instant-prizes` | `s-maxage=60` | só se a flag estiver ligada |
| `POST /api/checkout/identify` | — | RL IP + CPF, honeypot, Turnstile opcional |
| `POST /api/checkout/reserve` | — | RL, honeypot, Origin check |
| `GET /api/orders/[publicId]/status` | `no-store` | lazy expire; polling de 3s |
| `GET /api/orders/[publicId]/numbers.csv` | `no-store` | só se `PAID` |
| `POST /api/orders/[publicId]/simulate-payment` | — | **inexistente em production** |
| `POST /api/meus-numeros/lookup` | — | RL 5/15min por IP e por CPF → cookie assinado de 15 min |
| `GET /api/meus-numeros/orders?page=` / `.csv` | `no-store` | cookie assinado |
| `POST /api/webhooks/payments/[provider]` | — | assinatura + idempotência + conferência de valor e txid |
| `POST /api/cron/{expire,reconcile,generate-pool,retention}` | — | header `CRON_SECRET` |
| `GET /api/health` | — | DB + Redis |

### 7.3 Admin (`/admin`, RSC + Server Actions, RBAC por módulo)
`login`, `2fa`, `dashboard`, `campanhas` (`[id]/editar`, `[id]/cotas-casa`, `[id]/regulamento`, `[id]/ofertas`, `[id]/premiadas`, `[id]/ranking`, `[id]/apuracao`), `pedidos`, `participantes`, `financeiro`, `ganhadores`, `configuracoes`, `modalidades`, `conteudo`, `usuarios`, `auditoria`.

Matriz de permissões (proposta):

| Módulo | owner | operador | financeiro | suporte |
|---|---|---|---|---|
| Campanhas, regulamento, ofertas, premiadas | RW | RW | R | R |
| Cotas da casa | RW | RW | R | — |
| Apuração | RW | 1ª digitação | — | — |
| Pedidos | RW | R | RW (reembolso) | R + reenvio de e-mail |
| Participantes / export CSV | RW | R | R | R (sem export) |
| Financeiro | RW | — | RW | — |
| Settings, modalidades, usuários | RW | — | — | — |
| Audit log | R | R | R | — |

---

## 8. Segurança e LGPD: pontos de implementação

| Requisito | Como |
|---|---|
| CPF em repouso | AES-256-GCM com chave versionada (`CRYPTO_KEYS` no env) + `cpfHash` HMAC com pepper separada |
| CPF digitado não expõe dados | `identify` responde só `{known, maskedName:"J***** V.", maskedPhone:"(99) *****-3568", missing:[…]}`. Teste dedicado (seção 15). |
| Cadastro existente não é sobrescrito | Checkout público só **completa campos vazios**; nunca altera nome, e-mail ou telefone já gravados (D-12) |
| Nomes públicos | `domain/mask.ts`: "Primeiro nome + inicial do último sobrenome." |
| Logs | pino com redaction; Sentry com `beforeSend` removendo body e cookies |
| Headers | CSP com nonce, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` |
| CSRF | Server Actions (origin check nativo) + checagem de `Origin` nas rotas POST públicas |
| Admin | argon2id, TOTP obrigatório, bloqueio progressivo após 5 falhas, `sessionVersion` |
| Aviso 18+ | Rodapé fixo em todas as páginas |

---

## 9. Riscos (ordem de impacto no negócio)

| # | Risco | Impacto | Mitigação proposta |
|---|---|---|---|
| R-01 | **Base legal da operação.** No Brasil, vender chances de prêmio exige enquadramento específico (ex.: título de capitalização via sociedade de capitalização autorizada pela SUSEP, ou outra modalidade). Em alguns modelos, **quem emite e numera os títulos é a capitalizadora**, não a plataforma. | Pode invalidar o motor de números como desenhado e expor o operador a sanções. | Q2. Até a resposta, o motor fica isolado atrás de uma interface (`NumberAllocator`) para permitir integrar uma série externa. |
| R-02 | **PSP congelar a conta.** Vários PSPs restringem sorteios e rifas nos termos de uso. | Receita retida no pico da campanha. | Q3: aceite **por escrito** do PSP, com a autorização apresentada. Prever 2 adapters prontos para troca rápida. |
| R-03 | **Cotas da casa x publicidade enganosa (CDC art. 37).** "X% esgotado" incluindo cotas não vendidas pode ser questionado como indução ao erro, mesmo com cláusula no regulamento. | Reclamação no Procon/MP, dano reputacional, questionamento da autorização. | Implemento como especificado + recomendo nota visível junto à barra (D-06, Q6). Validação jurídica antes de usar em production. |
| R-04 | **10M de linhas (DEFAULT_7).** ~1,5 GB por campanha, geração mais lenta, custo de banco. | Custo e tempo de publicação. | Particionamento por campanha + arquivar a partição após `FINISHED`. Alternativa futura: alocação por permutação sem pool (só grava os números vendidos). |
| R-05 | **Contenção na linha de contadores** a 50 reservas/s. | Fila de locks, timeouts no pico. | 16 shards por campanha; leitura = SUM de 16 linhas, cacheada. |
| R-06 | **Enumeração de CPF** no passo 1 (descobrir quem é cliente + iniciais e final do telefone). | Vazamento parcial de PII, phishing direcionado. | RL por IP e CPF, honeypot, Turnstile ligável (Q10), resposta com tempo constante. |
| R-07 | **"Meus números" por CPF + data de nascimento** é autenticação fraca (ambos vazam com frequência). | Terceiro vê números e pedidos de outra pessoa. | Tela mostra só números, status e valores, sem PII; RL 5/15min; OTP via WhatsApp na fase futura. |
| R-08 | **Integridade interna (insider).** Quem tem acesso ao banco conhece o `shuffle_rank` e poderia prever a saída das cotas premiadas. | Fraude nas cotas premiadas. | Seed secreta + hash publicado na publicação (D-07); audit log append-only; admin não escolhe números. |
| R-09 | **Limites do serverless** (tempo de função, cron por minuto, conexões ao banco). | Pool não gera, jobs atrasam, conexões esgotam. | Lotes idempotentes, pooler (PgBouncer/Neon/Supabase), Vercel Pro para cron de 1 min (Q4). |
| R-10 | **Placeholders soltos no template**: `[N]`, `[endereço]`, `[nome/e-mail]` não começam com `PREENCHER` e passariam pela trava. Além disso, `{max}` aparece com dois sentidos (maior número e limite por CPF). | Regulamento publicado com lacunas ou com valor errado. | Seed reescrito com `[PREENCHER: …]` em todos os campos; variáveis renomeadas para `{max_numero}` e `{max_por_cpf}`; o item 5 é gerado conforme a `drawRule` (D-10). |
| R-11 | **Gap de dados: cidade/UF do ganhador.** A página de resultado exige, mas o checkout não coleta. | Página de resultado incompleta. | Coletar na validação do ganhador (admin), sem fricção no checkout (D-14). |
| R-12 | **E-mail na caixa de spam** (domínio novo, picos de volume). | Cliente não recebe os números e chama o suporte. | SPF, DKIM e DMARC no domínio antes da F1 em staging; a tela de confirmação e "Meus números" são a fonte primária. |

---

## 10. Perguntas bloqueantes (máx. 10)

Cada pergunta traz minha recomendação, para você só confirmar ou corrigir.

**Q1. Onde fica o código?** Este repositório é o toolkit `ui-ux-pro-max-skill`. Criei o plano em `pa-premios/` (como já existe `cat-feeding-app/`), mas um app Next.js com banco, segredos e CI não deveria dividir repositório com o skill.
→ *Recomendo:* repositório novo e privado (`pa-premios`), com a F0 começando lá. Se preferir manter aqui, a F0 vira um subprojeto com CI próprio, filtrado por path.

**Q2. Qual é o enquadramento legal exato (modalidade, órgão) e quem numera os títulos?** Exemplo: capitalização (filantropia premiável ou incentivo) via capitalizadora parceira, ou outra modalidade. Se a capitalizadora fornecer série ou faixa de números, o pool precisa vir dela.
→ *Recomendo:* confirmar com o jurídico antes da F1. Isso define se o motor gera os números ou importa a série.

**Q3. Qual PSP de PIX e há aceite formal da atividade?** Efí, Asaas ou Mercado Pago? Já existe conta aprovada para esse ramo?
→ *Recomendo:* o PSP que já aprovou a conta **por escrito** para a atividade, com a autorização anexada. Sem isso, nenhum adapter real entra na F5.

**Q4. Infraestrutura de produção:** Vercel Pro (região `gru1`) + Postgres gerenciado em São Paulo (Neon ou Supabase `sa-east-1`) + Upstash. Confirma? Ou prefere VPS própria?
→ *Recomendo:* Vercel Pro + Neon/Supabase SP. É o menor custo operacional para picos curtos; o cron de 1 min exige plano Pro.

**Q5. DEFAULT_7: qual é exatamente o "3º algarismo do 3º prêmio" e onde ele entra?** Contado da esquerda ou da direita? Entra no início ou no fim do número de 7 dígitos? Peço um exemplo resolvido (5 prêmios → número final), como o do concurso 6111.

**Q6. Cotas da casa: o jurídico validou o uso com a modalidade (Q2), e você aceita uma nota de transparência junto à barra?** Por exemplo: "ⓘ inclui números reservados pelo promotor, que não concorrem". Sem a nota, o risco R-03 fica com vocês.
→ *Recomendo:* nota ligada por padrão, com o texto editável no admin.

**Q7. Reembolso e cancelamento: o que acontece com os números?** (a) Reembolso antes do encerramento devolve os números ao estoque? (b) Reembolso depois do encerramento deixa o número "não pago", portanto fora da apuração? (c) Pagamento tardio com a campanha já encerrada: reembolso automático via API do PSP ou manual?
→ *Recomendo:* (a) sim; (b) sim; (c) manual com alerta, até termos confiança no adapter.

**Q8. Limite por CPF e order bump:** o "Limite de {max} cotas por CPF" do regulamento é igual ao máximo por pedido (20.000)? As cotas do bump contam para os limites por pedido e por CPF?
→ *Recomendo:* limite por CPF igual a 20.000 no seed; bump conta para os dois limites.

**Q9. Dupla digitação da apuração: pode ser o mesmo usuário ou exige dois usuários diferentes (quatro olhos)?**
→ *Recomendo:* dois usuários diferentes em production (um operador digita, o owner confirma); o mesmo usuário apenas em dev/staging.

**Q10. Anti-bot no checkout:** autoriza Cloudflare Turnstile (gratuito, invisível na maioria dos casos) para `identify`, `reserve` e "Meus números"? Ele adiciona uma dependência externa e uma fricção mínima.
→ *Recomendo:* implementar desligado e ligar no 1º pico com sinal de abuso.

---

## 11. Plano por fases (seção 17), com entregáveis técnicos

| Fase | Entregáveis principais | Aceite (spec) + extra |
|---|---|---|
| **F0 — Setup** | Repo, pnpm, TS strict, ESLint/Prettier, Docker Compose (postgres, redis, mailpit, minio), Prisma + migrations SQL manuais, `env.ts`, faixa de staging, CI (lint, typecheck, unit, integração, e2e smoke), CLAUDE.md | `pnpm dev` sobe; CI verde |
| **F1 — Núcleo de venda** | Página da campanha, seletor aditivo, bottom sheet de checkout (5 passos), motor de números, pool em lotes, MockProvider + "simular pagamento", expiração (cron + lazy), pagamento tardio, confirmação, e-mail, grupo de WhatsApp, botão de suporte, banner antigolpe, Meus números, rodapé legal | E2E mobile 390x844; 200 reservas concorrentes sem duplicidade; mín./máx.; menor de 18 bloqueado; CPF não expõe dados; **+ benchmark: 20k números em < 2s** |
| **F2 — Admin** | Auth + TOTP, RBAC, campanhas + estados + checklist de publicação por `APP_ENV`, travas (app + trigger), modalidades, opção em dinheiro condicionada, regulamento versionado + PDF + hash, pedidos, participantes + CSV com log, settings, audit log | Publicação bloqueada em prod / aviso em staging; travas pós-venda; dinheiro só com `allowsCashPrize` |
| **F3 — Conversão** | Barra + cotas da casa (slider, quantidade, prévia), marcos, ranking geral e do dia, order bump com validação, compartilhamento, cotas premiadas (flag) | Testes da seção 15: casa a 50% exata e sem colisão; casa fora do ranking e das premiadas; ranking zera às 00:00 de Fortaleza; bump acima do linear rejeitado |
| **F4 — Apuração** | Dupla digitação, cálculo, aproximação, página de resultado, ganhadores, imutabilidade | Concurso 6111 → 003062; casa → próximo pago; não vendido → circular |
| **F5 — Produção** | Adapter PIX real + webhooks + reconciliação, rate limit afinado, Sentry, backups (PITR do provedor + dump diário externo), k6 | 300 req/s na página; 50 reservas/s; LCP < 2,5s em 4G |

Diretrizes de UI (do toolkit ui-ux-pro-max, aplicadas ao contexto): alvos de toque ≥ 44px, texto ≥ 16px (evita zoom no iOS), contraste AA, `prefers-reduced-motion`, ícones SVG (Lucide) em vez de emoji, barra fixa inferior com `env(safe-area-inset-bottom)` e botão de suporte posicionado **acima** dela, sem sobrepor conteúdo. Cores e logo vêm de `settings`.

---

## 12. Oportunidades fora da spec (não implementar sem aprovação)

1. **Recuperação de reserva expirada** por e-mail transacional ("seus números expiraram, reserve de novo"): costuma ser a alavanca de conversão de maior retorno nesse modelo. Exige validar a base legal da mensagem (transacional x marketing).
2. **Página pública de auditoria por campanha** (hash do regulamento, hash da seed, contagem final por status após a apuração): reforça a confiança e responde ao risco R-03.
3. **UTM e origem por pedido** (Instagram, WhatsApp, story específico): mede qual canal gera receita, não só tráfego.
