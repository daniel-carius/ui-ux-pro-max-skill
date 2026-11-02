-- pg_cron (SPEC 2 e 6.3). A extensão só pode existir no banco definido em cron.database_name
-- (no Supabase: "postgres"). Em outros bancos do mesmo servidor (shadow do Prisma, banco de testes)
-- a criação é pulada; jobs para eles usam cron.schedule_in_database().
-- Se o pg_cron não estiver em shared_preload_libraries, current_setting retorna NULL e o
-- CREATE EXTENSION falha de propósito: ambiente mal configurado não pode passar despercebido.
DO $$
DECLARE
  cron_db text := current_setting('cron.database_name', true);
BEGIN
  IF cron_db IS NULL OR cron_db = current_database() THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  ELSE
    RAISE NOTICE 'pg_cron não criado em %: cron.database_name = %', current_database(), cron_db;
  END IF;
END
$$;
