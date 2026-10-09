#!/bin/sh
# Primeira subida do Postgres (volume vazio): cria o usuário com que a API conecta (x2win_app).
# Ele não é superusuário nem dono de nenhuma tabela. Os privilégios vêm da migração 002, aplicada pelo serviço
# "migrate" com o dono das tabelas: leitura e escrita nas tabelas de operação; na auditoria, só SELECT e INSERT
# (sem UPDATE, DELETE, TRUNCATE nem ALTER/DROP TRIGGER).
#
# Banco que já existia antes desta versão: depois de rodar as migrações, dê login e senha ao papel uma vez:
#   docker compose --env-file deploy/.env exec db psql -U x2win -d x2win \
#     -c "alter role x2win_app login password '<APP_DB_PASSWORD>'"
set -eu
: "${APP_DB_PASSWORD:?defina APP_DB_PASSWORD em deploy/.env}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_pw APP_DB_PASSWORD
create role x2win_app login password :'app_pw' nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
SQL
