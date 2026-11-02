

-- Role restrito da aplicação. A migration cria o role como NOLOGIN se não existir;
-- no dev/CI ele já nasce com LOGIN e senha conhecida. Em staging/production a senha
-- é definida fora do repositório (docs/supabase-setup.md).
CREATE ROLE pa_app LOGIN PASSWORD 'pa_app';
