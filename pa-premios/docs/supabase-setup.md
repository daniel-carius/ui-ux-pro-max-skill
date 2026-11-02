# Setup do Supabase, Vercel e Upstash (staging e production)

Checklist para quem tem acesso às contas. Nada aqui pode ser feito pelo agente.

## 1. Projeto Supabase

1. Criar o projeto na região **South America (São Paulo)**. Um projeto para staging e outro para production.
2. Anotar a **versão major do Postgres** exibida no painel. Se não for 16, ajustar `PG_MAJOR` em
   `docker-compose.yml` para manter dev/CI iguais à produção (DECISIONS D-22).
3. **Data API:** Settings → API → _Exposed schemas_: remover `public`. A migration
   `20261102000300_supabase_api_lockdown` também revoga tudo dos roles `anon`/`authenticated` (D-27).
4. **pg_cron:** Database → Extensions → habilitar `pg_cron` (a migration também tenta criar; no Supabase
   `cron.database_name` = `postgres`).

## 2. Conexões

| Variável       | Origem no Supabase                                                | Observação                                                                                                                  |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DIRECT_URL`   | _Session pooler_ (porta 5432) ou conexão direta                   | A conexão direta é só IPv6 sem o add-on de IPv4; GitHub Actions e Vercel usam IPv4 → usar o session pooler para migrations. |
| `DATABASE_URL` | _Transaction pooler_ (porta 6543), usuário `pa_app.<project-ref>` | Acrescentar `?pgbouncer=true&connection_limit=5` (D-26).                                                                    |

## 3. Role da aplicação

Depois do primeiro `pnpm db:deploy` (que cria `pa_app` como NOLOGIN), no SQL editor:

```sql
ALTER ROLE pa_app LOGIN PASSWORD '<senha forte gerada no cofre>';
```

Nunca usar o role `postgres` na `DATABASE_URL`.

## 4. Storage (F2)

Bucket **privado** `winner-documents` (documentos de ganhadores e da autorização). Acesso apenas por URL
assinada de curta duração gerada no servidor; cada acesso vai para o audit log.

## 5. Vercel

- Plano Pro, região de funções `gru1` (já em `vercel.json`).
- Variáveis por ambiente (Preview = staging, Production = production): todas as de `.env.example`,
  com `APP_ENV` correspondente. `CRON_SECRET` com 32+ caracteres.

## 6. Upstash

Banco Redis na região São Paulo (`sa-east-1`). Copiar `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
