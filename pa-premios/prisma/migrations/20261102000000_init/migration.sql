-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "territorial_rule" AS ENUM ('PHYSICAL_LOCATION', 'DOMICILE', 'PHYSICAL_OR_DOMICILE');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('ADMIN', 'SYSTEM', 'CUSTOMER');

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "brand_name" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL,
    "secondary_color" TEXT NOT NULL,
    "support_whatsapp" TEXT NOT NULL,
    "support_message" TEXT NOT NULL,
    "whatsapp_group_url_default" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Fortaleza',
    "legal_name" TEXT,
    "cnpj" TEXT,
    "address" TEXT,
    "sac_email" TEXT,
    "dpo_name" TEXT,
    "dpo_email" TEXT,
    "show_authorization_badge" BOOLEAN NOT NULL DEFAULT false,
    "authorized_state" CHAR(2),
    "territorial_rule" "territorial_rule" NOT NULL DEFAULT 'PHYSICAL_LOCATION',
    "geo_enforcement" BOOLEAN NOT NULL DEFAULT true,
    "anti_scam_enabled" BOOLEAN NOT NULL DEFAULT true,
    "anti_scam_text" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "campaign_id" INTEGER,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_created_at_idx" ON "audit_log"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_campaign_id_created_at_idx" ON "audit_log"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

