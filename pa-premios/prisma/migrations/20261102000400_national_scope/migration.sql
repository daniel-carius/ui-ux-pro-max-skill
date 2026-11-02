-- SPEC 2.1: abrangência nacional, sem bloqueio geográfico (SPEC 3, 13A, 19.14).
-- Os campos do modo STATE saem; authorization_scope fica como ponto de extensão.
ALTER TABLE "settings"
  DROP COLUMN "authorized_state",
  DROP COLUMN "territorial_rule",
  DROP COLUMN "geo_enforcement";

DROP TYPE "territorial_rule";

CREATE TYPE "authorization_scope" AS ENUM ('NATIONAL', 'STATE');

ALTER TABLE "settings"
  ADD COLUMN "authorization_scope" "authorization_scope" NOT NULL DEFAULT 'NATIONAL',
  -- Q4: Turnstile. NULL = default do ambiente (ligado só em production).
  ADD COLUMN "turnstile_enabled" BOOLEAN;
