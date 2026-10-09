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

export const MIGRATIONS: Migration[] = [{ id: '001_init', sql: m001 }]
