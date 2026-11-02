-- Guardas no banco (SPEC 8.3, 12.13, 15, 19.7). Escrito à mão: o Prisma não gera triggers nem grants.

-- 1) Role restrito da aplicação.
--    A aplicação conecta como pa_app (via pooler). Migrations rodam como dono do schema.
--    Em staging/production, LOGIN e senha são definidos fora do repositório (ver docs/supabase-setup.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pa_app') THEN
    CREATE ROLE pa_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pa_app;
-- _prisma_migrations não existe no shadow database do `prisma migrate dev`.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public."_prisma_migrations" FROM pa_app;
  END IF;
END
$$;

-- 2) settings: linha única.
ALTER TABLE "settings" ADD CONSTRAINT "settings_single_row" CHECK ("id" = 1);

-- 3) audit_log append-only.
--    Camada 1: pa_app só tem SELECT e INSERT.
--    Camada 2: trigger bloqueia UPDATE/DELETE/TRUNCATE para qualquer role (inclusive o dono).
--    pa_app não é dono da tabela, portanto não consegue desabilitar o trigger.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM pa_app;

CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é append-only: % bloqueado', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();
