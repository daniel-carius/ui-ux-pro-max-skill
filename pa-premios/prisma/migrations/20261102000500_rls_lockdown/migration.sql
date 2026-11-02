-- D-27 (defesa em profundidade): RLS habilitado em TODAS as tabelas do schema public.
-- Se a Data API do Supabase for exposta por engano no futuro, anon/authenticated recebem vazio.
--
-- Por que existem policies: pa_app não é dono das tabelas, então RLS sem nenhuma policy
-- também bloquearia a própria aplicação. As policies abaixo valem SOMENTE para pa_app
-- (TO pa_app); qualquer outro role continua sem acesso. O dono (migrations, seed, funções
-- SECURITY DEFINER, jobs do pg_cron) não é afetado porque não usamos FORCE ROW LEVEL SECURITY.
--
-- Regra para migrations futuras: toda tabela nova em public precisa de ENABLE ROW LEVEL SECURITY
-- e de policy explícita para pa_app. O teste tests/integration/rls.test.ts falha se faltar.

ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_pa_app_all" ON "settings" FOR ALL TO pa_app USING (true) WITH CHECK (true);

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_pa_app_select" ON "audit_log" FOR SELECT TO pa_app USING (true);
CREATE POLICY "audit_log_pa_app_insert" ON "audit_log" FOR INSERT TO pa_app WITH CHECK (true);

-- _prisma_migrations: RLS sem policy (ninguém além do dono lê). Não existe no shadow database.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;
