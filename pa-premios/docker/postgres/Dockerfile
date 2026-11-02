# Postgres de desenvolvimento/CI com pg_cron (paridade com Supabase).
# PG_MAJOR deve acompanhar a versão do projeto Supabase (ver DECISIONS.md D-22).
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}
ARG PG_MAJOR
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-${PG_MAJOR}-cron \
 && rm -rf /var/lib/apt/lists/*
COPY init/ /docker-entrypoint-initdb.d/
