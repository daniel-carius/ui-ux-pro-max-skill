// Migrações do banco, em ordem. Nunca edite uma migração já aplicada em
// produção: crie a próxima (002_..., 003_...).
// Valores em dinheiro ficam em centavos (bigint). Datas em timestamptz.

export interface Migration {
  id: string
  sql: string
}

const m001 = `
-- Cargos e permissões ---------------------------------------------------------
create table roles (
  id text primary key,
  name text not null,
  description text not null default '',
  system boolean not null default false,
  permissions text[] not null default '{}',
  require_2fa boolean not null default false,
  -- null = sem teto; 0 = não aprova saques; > 0 = teto em centavos
  approval_ceiling_cents bigint,
  color text not null default 'violet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_ceiling_ck check (approval_ceiling_cents is null or approval_ceiling_cents >= 0)
);
create unique index roles_name_uq on roles (lower(name));

-- Pessoas da equipe -----------------------------------------------------------
create table users (
  id text primary key,
  name text not null,
  email text not null,
  role_id text not null references roles(id),
  status text not null check (status in ('ativo', 'desligado', 'convidado')),
  password_hash text,
  must_change_password boolean not null default false,
  -- segredo TOTP cifrado (AES-256-GCM); pendente enquanto o 2FA não for confirmado
  totp_secret_enc text,
  totp_pending_enc text,
  totp_enabled boolean not null default false,
  -- último passo de tempo aceito: impede reutilizar o mesmo código
  totp_last_counter bigint,
  -- códigos de recuperação (hash sha256), cada um usável uma vez
  recovery_codes text[] not null default '{}',
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_access_at timestamptz,
  last_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

-- Sessões (o cookie guarda o token; o banco guarda só o hash) -----------------
create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  stage text not null check (stage in ('password', 'enroll', '2fa', 'active')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;

-- Convites para a equipe ------------------------------------------------------
create table invites (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_by text,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Segurança do painel (linha única) -----------------------------------------
create table panel_security (
  id int primary key default 1 check (id = 1),
  allowlist jsonb not null default '[]'::jsonb,
  enforce_2fa_all boolean not null default false,
  session_timeout_minutes int not null default 240 check (session_timeout_minutes between 5 and 1440),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into panel_security (id) values (1);

-- Auditoria: somente inclusão ------------------------------------------------
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id text,
  actor_name text not null,
  action text not null,
  entity text not null,
  summary text not null,
  ip text,
  -- 'servidor' = registrado pela API; 'painel' = relatado pela tela (quem/quando/IP vêm do servidor)
  source text not null default 'servidor' check (source in ('servidor', 'painel'))
);
create index audit_at_idx on audit_log (at desc);
create index audit_actor_idx on audit_log (actor_id, at desc);

create function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'a auditoria aceita apenas inclusão';
end
$$;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- Saques ---------------------------------------------------------------------
create table withdrawals (
  id text primary key,
  player_id text not null,
  player_name text not null,
  player_email text not null,
  amount_cents bigint not null check (amount_cents > 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  status text not null check (status in ('criado', 'pendente', 'em_analise', 'aprovado', 'recusado', 'expirado', 'cancelado')),
  risk_level text not null check (risk_level in ('baixo', 'medio', 'alto')),
  risk_score int not null,
  risk_reasons jsonb not null default '[]'::jsonb,
  pix_key_type text not null,
  pix_key_enc text not null,
  reference text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  decided_by text,
  decided_by_id text,
  decision_note text
);
create index withdrawals_status_idx on withdrawals (status, created_at desc);

-- Configurações de domínio validadas pelo servidor (ex.: regras de saque) ----
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Dados das demais telas (JSON por chave, com versão para evitar sobrescrita) -
create table kv_store (
  key text primary key,
  -- valor em claro OU cifrado (chaves com segredos/dados pessoais)
  value jsonb,
  value_enc text,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint kv_one_value_ck check ((value is null) <> (value_enc is null))
);

-- Webhooks -------------------------------------------------------------------
create table webhook_destinations (
  id text primary key,
  event text not null,
  url text not null,
  active boolean not null default true,
  secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table webhook_outbox (
  id bigserial primary key,
  event text not null,
  payload jsonb not null,
  destination_id text not null references webhook_destinations(id) on delete cascade,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'entregue', 'falhou')),
  last_error text,
  created_at timestamptz not null default now()
);
create index webhook_outbox_due_idx on webhook_outbox (next_attempt_at) where status = 'pendente';

create table webhook_executions (
  id text primary key,
  at timestamptz not null default now(),
  event text not null,
  destination_id text,
  url text not null,
  status text not null check (status in ('sucesso', 'falha')),
  http_status int,
  duration_ms int,
  payload text not null,
  test boolean not null default false
);
create index webhook_exec_at_idx on webhook_executions (at desc);
`

/** Papel com que a API roda (não é dono de nenhuma tabela nem superusuário). */
export const RUNTIME_ROLE = 'x2win_app'

const m002 = `
-- Auditoria só aceita inclusão também contra TRUNCATE: gatilho por linha não dispara em TRUNCATE.
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_immutable();

-- Papel de execução da API (${RUNTIME_ROLE}). Quem roda as migrações é o dono das tabelas; a API conecta com um
-- usuário deste papel, que não é dono de nada: não consegue TRUNCATE, ALTER/DROP TRIGGER nem DROP TABLE.
-- O usuário com login e senha é criado pela implantação (deploy/db-init); aqui, se ainda não existir, o papel
-- nasce sem login. Os privilégios dele não ficam nesta migração: migrate() os reaplica em toda execução
-- (RUNTIME_GRANTS_SQL), então "crie o papel e rode as migrações de novo" funciona mesmo depois de a 002 constar
-- como aplicada. (Versões anteriores concediam os privilégios aqui; o estado final do banco é o mesmo.)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = '${RUNTIME_ROLE}') then
    begin
      create role ${RUNTIME_ROLE} nologin;
    exception when insufficient_privilege then
      raise notice 'sem permissão para criar o papel ${RUNTIME_ROLE}: crie-o (deploy/db-init/10-x2win-app-role.sh) e rode "npm run migrate" de novo';
    end;
  end if;
end
$$;
`

/**
 * Chaves com histórico cifradas em repouso (regra com `history` e `pii`/`secrets`), na versão em vigor de
 * kv_history_immutable(): só as linhas de histórico delas aceitam a cifra feita na subida. Vazia: nenhuma chave com
 * histórico tem dado pessoal nem segredo, então toda linha de histórico recusa qualquer UPDATE (o gatilho não tem como
 * conferir que value_enc é a cifra de value: com a exceção aberta, a linha podia ser trocada por qualquer valor).
 * Chave com histórico que ganhar `pii`/`secrets` precisa de uma migração nova que recrie a função com a lista nova
 * (kvHistoryImmutableSql) e atualize esta lista; o teste do histórico em kv-records.test.ts compara com KV_RULES.
 */
export const KV_HISTORY_ENCRYPTED_KEYS: readonly string[] = []

/** Função do gatilho do histórico (create or replace), com as chaves cujas linhas de histórico aceitam a cifra. */
export function kvHistoryImmutableSql(encryptedKeys: readonly string[]): string {
  const keys = encryptedKeys.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ')
  return `
create or replace function kv_history_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if left(old.key, 6) = '~hist:' then
      raise exception 'o histórico de dados aceita apenas inclusão';
    end if;
    return old;
  end if;
  if left(old.key, 6) = '~hist:' or left(new.key, 6) = '~hist:' then
    if new.key = old.key
       and split_part(substr(old.key, 7), '@', 1) = any (array[${keys}]::text[])
       and old.value is not null and old.value_enc is null
       and new.value is null and new.value_enc is not null
       and new.version = old.version
       and new.updated_at = old.updated_at
       and new.updated_by is not distinct from old.updated_by then
      return new;
    end if;
    raise exception 'o histórico de dados aceita apenas inclusão';
  end if;
  return new;
end
$$;
`
}

const m003 = `
-- Histórico das chaves (linhas "~hist:<chave>@<versão>" de kv_store): só inclusão, como a auditoria. A única mudança
-- aceita numa linha de histórico é a cifra em repouso feita na subida (kv/store.ts › encryptPlainRows), e só nas
-- chaves com histórico cifradas em repouso (KV_HISTORY_ENCRYPTED_KEYS, hoje nenhuma): value vira null e value_enc é
-- preenchido, sem mudar chave, versão, data nem autor. Também não deixa uma linha comum virar histórico (troca de chave).
${kvHistoryImmutableSql(KV_HISTORY_ENCRYPTED_KEYS)}
create trigger kv_history_no_change before update or delete on kv_store
  for each row execute function kv_history_immutable();

-- Leitura da auditoria por origem (janelas separadas de servidor e painel em auditoria.registros).
create index audit_source_at_idx on audit_log (source, at desc, id desc);

-- Endereço do destino de webhook cifrado em repouso (pode ter token no caminho ou na query): url_enc (AES-256-GCM)
-- e só o host em claro. SQL não cifra: as linhas antigas são cifradas na subida da API (webhooks/routes.ts, onReady),
-- e até lá o código ainda lê url.
alter table webhook_destinations alter column url drop not null;
alter table webhook_destinations add column url_enc text;
alter table webhook_destinations add column host text;
alter table webhook_destinations add constraint webhook_destinations_url_ck check (url is not null or url_enc is not null);

-- Excluir um destino não apaga mais em silêncio as entregas da fila (ordens saque.pago já aprovadas): a gravação da
-- lista marca as pendentes como 'falhou' ('Destino removido') e o item fica na fila, sem destino.
alter table webhook_outbox alter column destination_id drop not null;
alter table webhook_outbox drop constraint webhook_outbox_destination_id_fkey;
alter table webhook_outbox add constraint webhook_outbox_destination_id_fkey
  foreign key (destination_id) references webhook_destinations(id) on delete set null;
`

export const MIGRATIONS: Migration[] = [
  { id: '001_init', sql: m001 },
  { id: '002_audit_append_only', sql: m002 },
  { id: '003_ops_integrity', sql: m003 },
]

/**
 * Tabelas em que o papel de execução tem menos que leitura e escrita, com os privilégios que ele tem nelas.
 * RUNTIME_GRANTS_SQL reaplica exatamente estes privilégios em toda execução de migrate(). Tabela nova só de
 * inclusão (ou só leitura): faça o REVOKE na migração que a cria E inclua-a aqui.
 */
export const RUNTIME_TABLE_LIMITS: Readonly<Record<string, string>> = {
  audit_log: 'select, insert',
  schema_migrations: 'select',
}

const limitedTables = Object.keys(RUNTIME_TABLE_LIMITS)
  .map((t) => `'${t}'`)
  .join(', ')
const limitStatements = Object.entries(RUNTIME_TABLE_LIMITS)
  .map(
    ([t, privs]) => `  if to_regclass('public.${t}') is not null then
    revoke all on table public.${t} from ${RUNTIME_ROLE};
    ${privs ? `grant ${privs} on table public.${t} to ${RUNTIME_ROLE};` : ''}
  end if;`,
  )
  .join('\n')

/**
 * Privilégios do papel de execução, idempotentes: migrate() roda isto depois das migrações, em TODA execução, quando
 * quem conecta é o dono das tabelas (ou superusuário). Sem o papel, só avisa (migrate() decide se falha).
 *  - schema public: USAGE;
 *  - tabelas em que o papel ainda não tem privilégio nenhum (criadas antes de ele existir): leitura e escrita.
 *    Tabela em que algum privilégio já foi revogado não é alargada;
 *  - RUNTIME_TABLE_LIMITS: revoga tudo e concede só o que está lá (auditoria: SELECT e INSERT);
 *  - sequências: USAGE e SELECT; e os mesmos privilégios por padrão para as tabelas das próximas migrações.
 */
export const RUNTIME_GRANTS_SQL = `
do $$
declare
  app oid := (select oid from pg_roles where rolname = '${RUNTIME_ROLE}');
  t record;
begin
  if app is null then
    raise notice 'o papel ${RUNTIME_ROLE} não existe: crie-o (deploy/db-init/10-x2win-app-role.sh) e rode "npm run migrate" de novo';
    return;
  end if;
  grant usage on schema public to ${RUNTIME_ROLE};
  for t in
    select c.oid::regclass as rel
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and c.relname not in (${limitedTables})
       and pg_has_role(c.relowner, 'USAGE')
       and not exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = app)
  loop
    execute format('grant select, insert, update, delete on table %s to ${RUNTIME_ROLE}', t.rel);
  end loop;
  grant usage, select on all sequences in schema public to ${RUNTIME_ROLE};
${limitStatements}
  alter default privileges in schema public grant select, insert, update, delete on tables to ${RUNTIME_ROLE};
  alter default privileges in schema public grant usage, select on sequences to ${RUNTIME_ROLE};
end
$$;
`
