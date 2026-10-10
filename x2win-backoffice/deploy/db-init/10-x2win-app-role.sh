#!/bin/sh
# Primeira subida do Postgres (volume vazio): cria o usuário com que a API conecta (x2win_app).
# Ele não é superusuário nem dono de nenhuma tabela. Os privilégios vêm do serviço "migrate" (npm run migrate), que
# roda com o dono das tabelas e os (re)concede em TODA execução: leitura e escrita nas tabelas de operação; na
# auditoria, só SELECT e INSERT (sem UPDATE, DELETE, TRUNCATE nem ALTER/DROP TRIGGER).
#
# Banco que já existia antes desta versão: dê login e senha ao papel uma vez e rode as migrações de novo:
#   docker compose --env-file deploy/.env exec db psql -U x2win -d x2win \
#     -c "alter role x2win_app login password '<APP_DB_PASSWORD>'"
#
# Postgres gerenciado ou instalação sem este script (dono das tabelas sem CREATEROLE): um administrador do banco
# cria o papel com o mesmo comando abaixo, e então "npm run migrate" concede os privilégios. Sem o papel, o
# "npm run migrate" aplica as migrações mas sai com erro dizendo isso (e o serviço "migrate" não deixa a API subir).
set -eu
: "${APP_DB_PASSWORD:?defina APP_DB_PASSWORD em deploy/.env}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_pw APP_DB_PASSWORD
create role x2win_app login password :'app_pw' nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
SQL
