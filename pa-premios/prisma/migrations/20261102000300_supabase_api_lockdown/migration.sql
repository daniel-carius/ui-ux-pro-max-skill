-- Supabase expõe o schema public pela Data API (PostgREST) aos roles anon e authenticated,
-- e concede privilégios padrão a eles. A chave anon é pública: sem esta migration, tabelas
-- com PII poderiam ser lidas pela internet. Esta plataforma não usa a Data API.
-- Camada 1 (painel): remover "public" de Settings → API → Exposed schemas (docs/supabase-setup.md).
-- Camada 2 (aqui): revogar tudo de anon/authenticated. No dev/CI esses roles não existem e nada é feito.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
