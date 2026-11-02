# CLAUDE.md — P.A PRÊMIOS

Guia para agentes e devs. Fonte de verdade dos requisitos: `SPEC.md` (v2.1, abrangência nacional). Plano: `PLAN.md`.
Decisões sem regra na spec: `DECISIONS.md`. Fase atual: **F0 concluída, aguardando aprovação**.

## Regras de trabalho (SPEC 0)

- Prioridades: (1) nunca vender o mesmo número duas vezes, (2) compliance e integridade, (3) conversão mobile, (4) performance.
- Trabalhar por fase (SPEC 17). Ao fim de cada uma: testes, lint e typecheck limpos, commit `feat(fase-N): ...`, resumo, PARAR.
- Não inventar regra de negócio: perguntar ou deixar configurável com default conservador + registrar em `DECISIONS.md`.
- Nenhum texto de marca, telefone ou link hardcoded: tudo vem da tabela `settings`.
- Não reabrir decisões da SPEC 19 sem motivo técnico.

## Comandos

```bash
pnpm install
pnpm db:up            # docker compose: postgres(pg_cron) :5432, pgbouncer :6432, redis, redis-http :8079, mailpit :8025
cp .env.example .env
pnpm db:deploy        # aplica migrations (conexão direta)
pnpm db:seed
pnpm dev              # http://localhost:3000  ·  /api/health

pnpm lint && pnpm typecheck && pnpm format:check
pnpm test:unit
pnpm test:integration # cria um banco descartável por execução, aplica migrations, remove no fim
pnpm test:e2e         # Playwright 390x844 (sobe o dev server se não houver um rodando)
pnpm db:migrate       # criar nova migration (prisma migrate dev)
```

`prisma migrate reset` exige consentimento explícito do usuário quando executado por agente: não usar nos testes.

## Arquitetura (resumo)

- `app/` rotas (App Router). `src/domain/` regras puras, sem I/O (ESLint bloqueia imports de infra).
  `src/infra/` Prisma, Redis, settings. `src/env/` validação Zod do ambiente (falha cedo).
  `src/ui/` componentes. `prisma/` schema, migrations (SQL manual incluso), seed. `tests/{unit,integration,e2e}`.
- Banco: tabelas e colunas em snake_case (`@@map`/`@map`) para o SQL cru do motor ficar legível.

## Banco e conexões (decisões D-21, D-25, D-26)

- A aplicação usa `DATABASE_URL` = **pooler em modo transação** + role restrito **`pa_app`** + `pgbouncer=true`.
- Migrations, seed e tarefas longas usam `DIRECT_URL` (dono do schema).
- Travas do motor: SOMENTE presas à transação (`pg_advisory_xact_lock`, `SELECT ... FOR UPDATE SKIP LOCKED`,
  `SET LOCAL`). Proibido: `pg_advisory_lock` de sessão, `SET` sem `LOCAL`, tabelas temporárias, `LISTEN`,
  prepared statements nomeados. Validado em `tests/integration/pooler-transaction-mode.test.ts`.
- Transações interativas do Prisma atrás do pooler: passar `maxWait`/`timeout` explícitos (default de 2s
  de `maxWait` estoura com concorrência alta).
- `audit_log` é append-only: `pa_app` só tem SELECT/INSERT e um trigger bloqueia UPDATE/DELETE/TRUNCATE para
  qualquer role.
- pg_cron vive no banco de `cron.database_name`; jobs para outros bancos usam `cron.schedule_in_database`.
- **RLS em toda tabela de `public`**: toda migration que cria tabela deve incluir `ENABLE ROW LEVEL SECURITY`
  e policy explícita `TO pa_app` (D-27, D-42). `tests/integration/rls.test.ts` falha se faltar.
- Ordem do pool (`tickets.shuffle_rank`) é sigilosa: `pa_app` não lê essa coluna nem escreve em `tickets`;
  o motor usa funções `SECURITY DEFINER` com `search_path` fixo (D-07, F1).

## Convenções

- Dinheiro em centavos (Int); somatórios em BigInt. Horários em UTC; "dia" em America/Fortaleza.
- Zod em toda borda (env, API, forms, webhooks).
- Logs sem PII. Páginas públicas nunca mostram CPF, e-mail ou telefone completos.
- Abrangência nacional: nenhum bloqueio geográfico; país/UF do IP só como registro e sinal de fraude (SPEC 13A).
- Commits: `feat(fase-N): ...`, `fix: ...`, `docs: ...`, `test: ...`.
